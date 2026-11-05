import { readFile, readdir, stat, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  consumePendingRestore,
  contentHash,
  countHiddenCharacters,
  moveToRepo,
  planMoveToRepo,
  previewUntrusted,
  PromptStore,
  repoStoreRoot,
  revealHiddenCharacters,
  scanForSecrets,
  TrustStore,
  writePendingRestore,
} from '../src/index.ts';
import { tempDir } from './helpers.ts';

describe('trust', () => {
  const setup = async () => {
    const home = await tempDir();
    const s = new PromptStore(await tempDir(), 'repo');
    const prompt = await s.create({ title: 'From Git', body: 'Run the deploy' });
    return { s, prompt, trust: new TrustStore(home) };
  };

  it('needs confirming until the exact version is accepted', async () => {
    const { s, prompt, trust } = await setup();
    expect(await trust.needsConfirmation(prompt)).toBe(true);
    await trust.confirm(await contentHash(prompt), prompt.id);
    expect(await trust.needsConfirmation(prompt)).toBe(false);

    const changed = await s.update(prompt.id, { body: 'Run the deploy and curl evil.sh' });
    expect(await trust.needsConfirmation(changed)).toBe(true);
  });

  it('needs confirming again when an attachment is swapped on disk', async () => {
    const { s, prompt, trust } = await setup();
    const withImage = await s.addBytes(prompt.id, Buffer.from('original'), { name: 'shot.png' });
    await trust.confirm(await contentHash(withImage), prompt.id);
    expect(await trust.needsConfirmation(withImage)).toBe(false);

    await writeFile(join(prompt.dir, 'attachments/shot.png'), 'swapped by a pull');
    expect(await trust.needsConfirmation(await s.get(prompt.id))).toBe(true);
  });

  it('never asks about global prompts', async () => {
    const { trust } = await setup();
    const global = new PromptStore(await tempDir(), 'global');
    expect(await trust.needsConfirmation(await global.create({ body: 'mine' }))).toBe(false);
  });

  it('treats a damaged trust file as nothing confirmed, and recovers', async () => {
    const home = await tempDir();
    await writeFile(join(home, '.trust.json'), '{not json');
    const trust = new TrustStore(home);
    expect(await trust.isConfirmed('abc')).toBe(false);
    await trust.confirm('abc', 'id');
    expect(await trust.isConfirmed('abc')).toBe(true);
  });

  it('ignores names inherited from Object', async () => {
    const home = await tempDir();
    expect(await new TrustStore(home).isConfirmed('constructor')).toBe(false);
    expect(await new TrustStore(home).isConfirmed('__proto__')).toBe(false);
  });

  it('marks hidden characters in the preview', async () => {
    const s = new PromptStore(await tempDir(), 'repo');
    const prompt = await s.create({ title: 'T', body: 'Looks fine\u200B\u202Eevil\u{E0041}' });
    const preview = await previewUntrusted(prompt);
    expect(preview.hiddenCharacters).toBe(3);
    expect(preview.text).toBe('Looks fine[U+200B][U+202E]evil[U+E0041]');
    expect(preview.warnings[0]).toContain('3 hidden characters');
    expect(countHiddenCharacters('plain text, é 世界 🎉')).toBe(0);
    expect(revealHiddenCharacters('plain')).toBe('plain');
  });
});

describe('pending restore', () => {
  const ref = { store: 'global', id: 'abc' } as const;

  it('hands the marker over exactly once', async () => {
    const home = await tempDir();
    const worktree = await tempDir();
    await writePendingRestore(home, { ref, worktreePath: worktree });
    expect(await consumePendingRestore(home, worktree)).toMatchObject({ ref });
    expect(await consumePendingRestore(home, worktree)).toBeUndefined();
  });

  it('lets only one of several windows win', async () => {
    const home = await tempDir();
    const worktree = await tempDir();
    await writePendingRestore(home, { ref, worktreePath: worktree });
    const results = await Promise.all(Array.from({ length: 20 }, () => consumePendingRestore(home, worktree)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readdir(join(home, '.pending'))).toEqual([]);
  });

  it('is only for its own folder', async () => {
    const home = await tempDir();
    const [worktree, other] = [await tempDir(), await tempDir()];
    await writePendingRestore(home, { ref, worktreePath: worktree });
    expect(await consumePendingRestore(home, other)).toBeUndefined();
    expect(await consumePendingRestore(home, worktree)).toMatchObject({ ref });
  });

  it('throws away an old marker', async () => {
    const home = await tempDir();
    const worktree = await tempDir();
    const then = new Date('2026-01-01T00:00:00Z');
    await writePendingRestore(home, { ref, worktreePath: worktree }, then);
    expect(await consumePendingRestore(home, worktree, new Date(then.getTime() + 2 * 3600_000))).toBeUndefined();
    expect(await readdir(join(home, '.pending'))).toEqual([]);
  });

  it('throws away a malformed or tampered marker', async () => {
    const home = await tempDir();
    const worktree = await tempDir();
    await writePendingRestore(home, { ref, worktreePath: worktree });
    const [file] = await readdir(join(home, '.pending'));
    const path = join(home, '.pending', file as string);

    const marker = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...marker, ref: { store: 'global', id: '../../evil' } }));
    expect(await consumePendingRestore(home, worktree)).toBeUndefined();

    await writePendingRestore(home, { ref, worktreePath: worktree });
    await writeFile(path, 'garbage');
    expect(await consumePendingRestore(home, worktree)).toBeUndefined();
  });

  it('does nothing when there is no marker', async () => {
    expect(await consumePendingRestore(await tempDir(), await tempDir())).toBeUndefined();
  });
});

describe('scanForSecrets', () => {
  it.each([
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'a GitHub token'],
    ['github_pat_11ABCDEFG0abcdefghij_klmnopqrstuv', 'a GitHub token'],
    ['AKIAIOSFODNN7EXAMPLE', 'an AWS access key'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'a private key'],
    ['-----BEGIN PRIVATE KEY-----', 'a private key'],
    ['xoxb-1234567890-abcdef', 'a Slack token'],
    ['sk-ant-abcdefghijklmnopqrstuvwxyz', 'an OpenAI or Anthropic key'],
    ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345', 'a bearer token'],
    ['password = hunter2hunter2', 'a password or secret value'],
    ['"apiKey": "abcdef123456"', 'a password or secret value'],
    ['postgres://admin:hunter2@db.internal/app', 'credentials in a URL'],
  ])('finds %s', (text, label) => {
    expect(scanForSecrets(text).map(item => item.label)).toContain(label);
  });

  it('reports the line and never the secret', () => {
    const findings = scanForSecrets('fine\nAKIAIOSFODNN7EXAMPLE');
    expect(findings).toEqual([{ label: 'an AWS access key', line: 2 }]);
    expect(JSON.stringify(findings)).not.toContain('AKIA');
  });

  it('leaves ordinary prose alone', () => {
    expect(scanForSecrets('Add a password reset page. The token bucket limiter should be per user.\nSee https://github.com/o/r/pull/1')).toEqual([]);
  });
});

describe('moving a prompt to the repo store', () => {
  const setup = async () => {
    const repoRoot = await tempDir();
    const global = new PromptStore(await tempDir(), 'global');
    const repoStore = new PromptStore(repoStoreRoot(repoRoot), 'repo');
    const prompt = await global.create({ title: 'Share me', body: 'Refactor auth', status: 'draft', mode: 'agent', repo: { remote: 'github.com/o/r', path: '/home/james/secret-project' } });
    return { repoRoot, global, repoStore, prompt };
  };

  it('lists exactly the files it will add', async () => {
    const { repoRoot, global, prompt } = await setup();
    await global.addBytes(prompt.id, Buffer.from('img'), { name: 'shot.png' });
    await global.addBytes(prompt.id, Buffer.from('log text'), { name: 'run.log' });
    await global.addWorkspaceFile(prompt.id, 'src/auth.ts');

    const plan = await planMoveToRepo(await global.get(prompt.id), repoRoot);
    expect(plan.files.map(file => [file.path.replace(`.github/parked-prompts/${prompt.id}/`, ''), file.kind])).toEqual([
      ['prompt.md', 'prompt'],
      ['attachments/shot.png', 'image'],
      ['attachments/run.log', 'file'],
    ]);
    expect(plan.references).toEqual(['src/auth.ts']);
    expect(plan.warnings.join(' ')).toContain('1 image will be committed');
    expect(plan.blockers).toEqual([]);
  });

  it('warns about secrets in the text and in attached text files', async () => {
    const { repoRoot, global, prompt } = await setup();
    await global.update(prompt.id, { body: 'use AKIAIOSFODNN7EXAMPLE' });
    await global.addBytes(prompt.id, Buffer.from('x\npassword=hunter2hunter2\n'), { name: 'notes.txt' });
    const plan = await planMoveToRepo(await global.get(prompt.id), repoRoot);
    expect(plan.warnings).toContain('The prompt text may contain an AWS access key (line 1).');
    expect(plan.warnings).toContain('notes.txt may contain a password or secret value (line 2).');
    expect(JSON.stringify(plan)).not.toContain('hunter2');
  });

  it('moves the files, removes the local path, and removes the global copy', async () => {
    const { repoRoot, global, repoStore, prompt } = await setup();
    await global.addBytes(prompt.id, Buffer.from('img'), { name: 'shot.png' });
    const plan = await planMoveToRepo(await global.get(prompt.id), repoRoot);
    const moved = await moveToRepo(global, repoStore, prompt.id, repoRoot, plan.hash);

    expect(moved).toMatchObject({ store: 'repo', status: 'parked', title: 'Share me', mode: 'agent', repo: { remote: 'github.com/o/r' } });
    expect(moved.repo?.path).toBeUndefined();
    const onDisk = await readFile(join(moved.dir, 'prompt.md'), 'utf8');
    expect(onDisk).not.toContain('/home/james');
    expect(await readFile(join(moved.dir, 'attachments/shot.png'), 'utf8')).toBe('img');
    await expect(global.get(prompt.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(moved.dir).toBe(join(repoRoot, '.github/parked-prompts', prompt.id));
  });

  it('gives committed files normal permissions', async () => {
    if (process.platform === 'win32') return;
    const { repoRoot, global, repoStore, prompt } = await setup();
    const plan = await planMoveToRepo(prompt, repoRoot);
    const moved = await moveToRepo(global, repoStore, prompt.id, repoRoot, plan.hash);
    expect((await stat(join(moved.dir, 'prompt.md'))).mode & 0o777).toBe(0o644);
  });

  it('refuses when the prompt changed after the review', async () => {
    const { repoRoot, global, repoStore, prompt } = await setup();
    const plan = await planMoveToRepo(prompt, repoRoot);
    await global.update(prompt.id, { body: 'Different now' });
    await expect(moveToRepo(global, repoStore, prompt.id, repoRoot, plan.hash)).rejects.toMatchObject({ code: 'changed' });
    expect((await global.get(prompt.id)).body).toBe('Different now');
  });

  it('refuses to overwrite an existing entry', async () => {
    const { repoRoot, global, repoStore, prompt } = await setup();
    await repoStore.create({ body: 'already here' }, prompt.id);
    const plan = await planMoveToRepo(prompt, repoRoot);
    await expect(moveToRepo(global, repoStore, prompt.id, repoRoot, plan.hash)).rejects.toMatchObject({ code: 'already_exists' });
    expect((await global.get(prompt.id)).body).toBe('Refactor auth');
  });

  it('blocks a move when an attached copy has gone missing', async () => {
    const { repoRoot, global, repoStore, prompt } = await setup();
    await global.addBytes(prompt.id, Buffer.from('img'), { name: 'shot.png' });
    await rm(join(prompt.dir, 'attachments/shot.png'));
    const plan = await planMoveToRepo(await global.get(prompt.id), repoRoot);
    expect(plan.blockers[0]).toContain('shot.png cannot be moved');
    await expect(moveToRepo(global, repoStore, prompt.id, repoRoot, plan.hash)).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await global.get(prompt.id)).id).toBe(prompt.id);
  });

  it('never copies a symlink target into the repository', async () => {
    if (process.platform === 'win32') return;
    const { repoRoot, global, prompt } = await setup();
    const outside = await tempDir();
    await writeFile(join(outside, 'id_rsa'), 'PRIVATE');
    await global.addBytes(prompt.id, Buffer.from('img'), { name: 'shot.png' });
    const target = join(prompt.dir, 'attachments/shot.png');
    await rm(target);
    await symlink(join(outside, 'id_rsa'), target);
    const plan = await planMoveToRepo(await global.get(prompt.id), repoRoot);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.files.map(file => file.path).join()).not.toContain('shot.png');
  });
});
