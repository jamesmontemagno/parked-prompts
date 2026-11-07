import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyFile,
  cleanChatInputText,
  matchRepo,
  normalizeRelativePath,
  normalizeRemote,
  parseFileReference,
  parseGitRemotes,
  PromptCatalog,
  PromptStore,
  readRepoInfo,
  remoteLabel,
  repoDisplayName,
  resolveAttachments,
  safeFileName,
  slugify,
  withAttachmentPaths,
  workspaceRootFor,
} from '../src/index.ts';
import { tempDir } from './helpers.ts';

describe('normalizeRemote', () => {
  it.each([
    ['https://github.com/Owner/Repo.git', 'github.com/owner/repo'],
    ['https://github.com/owner/repo/', 'github.com/owner/repo'],
    ['http://github.com/owner/repo', 'github.com/owner/repo'],
    ['git@github.com:owner/repo.git', 'github.com/owner/repo'],
    ['github.com:owner/repo', 'github.com/owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'github.com/owner/repo'],
    ['ssh://git@ssh.github.com:443/owner/repo.git', 'github.com/owner/repo'],
    ['git+ssh://git@github.com/owner/repo.git', 'github.com/owner/repo'],
    ['git://github.com/owner/repo.git', 'github.com/owner/repo'],
    ['https://gitlab.example.com:8443/group/sub/repo.git', 'gitlab.example.com/group/sub/repo'],
    ['https://org@dev.azure.com/org/proj/_git/repo', 'dev.azure.com/org/proj/repo'],
    ['git@ssh.dev.azure.com:v3/org/proj/repo', 'dev.azure.com/org/proj/repo'],
    ['https://org.visualstudio.com/proj/_git/repo', 'dev.azure.com/org/proj/repo'],
  ])('%s', (input, expected) => {
    expect(normalizeRemote(input)).toBe(expected);
  });

  it('never keeps credentials', () => {
    const normalized = normalizeRemote('https://me:ghp_supersecrettoken@github.com/owner/repo.git');
    expect(normalized).toBe('github.com/owner/repo');
    expect(normalized).not.toContain('ghp_');
  });

  it.each(['', '/home/me/repo', './relative', '../repo', 'C:\\repos\\thing', 'file:///srv/git/repo.git', 'ext::sh -c touch%20/tmp/x', 'https://', 'github.com'])(
    'gives nothing for %s',
    input => {
      expect(normalizeRemote(input)).toBeUndefined();
    },
  );

  it('makes a short label', () => {
    expect(remoteLabel('github.com/owner/repo')).toBe('owner/repo');
  });
});

describe('repository display name', () => {
  it.each([
    ['owner/repo', 'repo'],
    ['group/subgroup/project', 'project'],
    ['Local Folder', 'Local Folder'],
    ['owner/Repo-Name/', 'Repo-Name'],
    ['', ''],
  ])('shortens %j to %j', (label, expected) => {
    expect(repoDisplayName(label)).toBe(expected);
  });
});

describe('parseGitRemotes', () => {
  it('reads remotes and ignores everything else', () => {
    const config = `
[core]
  url = not-this
[remote "origin"]
  fetch = +refs/heads/*:refs/remotes/origin/*
  url = git@github.com:o/r.git ; 
# url = commented
[REMOTE "upstream"]
  URL = "https://github.com/u/r"
[branch "main"]
  url = nope
`;
    const remotes = parseGitRemotes(config);
    expect(remotes.get('upstream')).toBe('https://github.com/u/r');
    expect(remotes.has('branch')).toBe(false);
    expect([...remotes.keys()]).toEqual(['origin', 'upstream']);
  });
});

describe('readRepoInfo', () => {
  const makeRepo = async (remoteUrl?: string) => {
    const root = await tempDir();
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), remoteUrl ? `[remote "origin"]\n\turl = ${remoteUrl}\n` : '[core]\n');
    return root;
  };

  it('finds the repository from a subfolder', async () => {
    const root = await makeRepo('git@github.com:Owner/Repo.git');
    const nested = join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });
    expect(await readRepoInfo(nested)).toEqual({ root, remote: 'github.com/owner/repo', isWorktree: false, label: 'owner/repo' });
  });

  it('prefers origin, and falls back to the first remote', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), '[remote "fork"]\n url = https://github.com/f/r\n[remote "origin"]\n url = https://github.com/o/r\n');
    expect((await readRepoInfo(root))?.remote).toBe('github.com/o/r');
    await writeFile(join(root, '.git', 'config'), '[remote "fork"]\n url = https://github.com/f/r\n');
    expect((await readRepoInfo(root))?.remote).toBe('github.com/f/r');
  });

  it('follows a linked worktree to the shared config', async () => {
    const main = await makeRepo('https://github.com/o/r.git');
    const gitDir = join(main, '.git', 'worktrees', 'wt');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'commondir'), '../..\n');
    const worktree = await tempDir();
    await writeFile(join(worktree, '.git'), `gitdir: ${gitDir}\n`);
    expect(await readRepoInfo(worktree)).toEqual({ root: worktree, remote: 'github.com/o/r', isWorktree: true, label: 'o/r' });
  });

  it('handles no remote and no repository', async () => {
    const root = await makeRepo();
    const info = await readRepoInfo(root);
    expect(info?.remote).toBeUndefined();
    expect(info?.root).toBe(root);
    expect(await readRepoInfo('/')).toBeUndefined();
  });
});

describe('matchRepo', () => {
  const current = { root: '/work/repo', remote: 'github.com/o/r' };

  it('matches by remote across clones and worktrees', () => {
    expect(matchRepo({ remote: 'github.com/o/r', path: '/old/clone' }, current)).toBe('remote');
  });

  it('falls back to the path when there is no shared remote', () => {
    expect(matchRepo({ path: '/work/repo' }, current)).toBe('path');
    expect(matchRepo({ remote: 'github.com/other/r', path: '/work/repo' }, current)).toBe('path');
    expect(matchRepo({ path: '/work/repo/' }, { root: '/work/repo' })).toBe('path');
  });

  it('does not match other repositories', () => {
    expect(matchRepo({ remote: 'github.com/other/r', path: '/else' }, current)).toBe('none');
    expect(matchRepo(undefined, current)).toBe('none');
    expect(matchRepo({ remote: 'github.com/o/r' }, undefined)).toBe('none');
  });
});

describe('catalog scopes', () => {
  const setup = async () => {
    const home = await tempDir();
    const root = await tempDir();
    const catalog = new PromptCatalog({ home, repo: { root, remote: 'github.com/o/r', isWorktree: false, label: 'o/r' } });
    await catalog.global.create({ body: 'this repo', repo: { remote: 'github.com/o/r' } }, 'here');
    await catalog.global.create({ body: 'other repo', repo: { remote: 'github.com/x/y' } }, 'other');
    await catalog.global.create({ body: 'no repo' }, 'loose');
    await catalog.repoStore?.create({ body: 'shared' }, 'shared');
    return { home, root, catalog };
  };
  const ids = (entries: { id: string }[]) => entries.map(entry => entry.id).sort();

  it('shows the open repository, including its repo store', async () => {
    const { catalog } = await setup();
    expect(ids((await catalog.list('repo')).prompts)).toEqual(['here', 'shared']);
  });

  it('reads across repositories in the all view', async () => {
    const { catalog } = await setup();
    expect(ids((await catalog.list('all')).prompts)).toEqual(['here', 'loose', 'other', 'shared']);
  });

  it('shows unscoped prompts when no repository is open', async () => {
    const { home } = await setup();
    const catalog = new PromptCatalog({ home });
    expect(ids((await catalog.list('repo')).prompts)).toEqual(['loose']);
  });

  it('hides the repo store when it is not allowed', async () => {
    const { home, root } = await setup();
    const catalog = new PromptCatalog({ home, repo: { root, remote: 'github.com/o/r', isWorktree: false, label: 'o/r' }, allowRepoStore: false });
    expect(ids((await catalog.list('all')).prompts)).toEqual(['here', 'loose', 'other']);
    expect(catalog.repoStore).toBeUndefined();
  });

  it('resolves workspace files only against a matching checkout', async () => {
    const { catalog } = await setup();
    const repo = catalog.repo;
    expect(workspaceRootFor(await catalog.global.get('here'), repo)).toBe(repo?.root);
    expect(workspaceRootFor(await catalog.global.get('other'), repo)).toBeUndefined();
    expect(workspaceRootFor(await catalog.global.get('loose'), repo)).toBeUndefined();
  });
});

describe('path safety', () => {
  it.each(['../x', 'a/../../x', '/etc/passwd', '\\\\server\\share', 'C:\\x', 'c:/x', '', '.', './', 'a\0b'])('refuses %j', input => {
    expect(() => normalizeRelativePath(input)).toThrow();
  });

  it('normalizes safe paths to POSIX form', () => {
    expect(normalizeRelativePath('src\\a.ts')).toBe('src/a.ts');
    expect(normalizeRelativePath('./src//b/./a.ts')).toBe('src/b/a.ts');
  });

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\win.ini', 'win.ini'],
    ['.env', 'env'],
    ['CON', 'file-CON'],
    ['con.txt', 'file-con.txt'],
    ['', 'file'],
    ['...', 'file'],
    ['a<b>:c.png', 'a_b__c.png'],
    ['line\nbreak.txt', 'linebreak.txt'],
  ])('safeFileName(%j)', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });

  it('shortens long names and keeps the extension', () => {
    const name = safeFileName(`${'x'.repeat(300)}.png`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('attachments', () => {
  it('classifies picked files', () => {
    expect(classifyFile('/repo/src/a.ts', '/repo')).toEqual({ kind: 'workspace', path: 'src/a.ts' });
    expect(classifyFile('/repo/shot.PNG', '/repo')).toEqual({ kind: 'copy' });
    expect(classifyFile('/else/a.ts', '/repo')).toEqual({ kind: 'copy' });
    expect(classifyFile('/repo/a.ts', undefined)).toEqual({ kind: 'copy' });
  });

  it('flags missing workspace files, and attaches the current version of the others', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/a.ts'), 'one');
    const s = new PromptStore(await tempDir(), 'global');
    const created = await s.create({ body: 'x' });
    await s.addWorkspaceFile(created.id, 'src/a.ts', { startLine: 1, endLine: 1 });
    await s.addWorkspaceFile(created.id, 'src/gone.ts');
    await s.addBytes(created.id, Buffer.from('i'), { name: 'i.png' });

    const { resolved, missing } = await resolveAttachments(await s.get(created.id), root);
    expect(resolved.map(item => [item.name, item.image])).toEqual([
      ['src/a.ts:1', false],
      ['i.png', true],
    ]);
    expect(await readFile(resolved[0]?.absolutePath as string, 'utf8')).toBe('one');
    expect(missing).toMatchObject([{ name: 'src/gone.ts', reason: 'not-found' }]);
  });

  it('reports workspace files as unavailable when no workspace is open', async () => {
    const s = new PromptStore(await tempDir(), 'global');
    const created = await s.create({ body: 'x' });
    await s.addWorkspaceFile(created.id, 'src/a.ts');
    const { missing } = await resolveAttachments(await s.get(created.id), undefined);
    expect(missing[0]?.reason).toBe('no-workspace');
  });

  it('blocks a repo prompt whose attachment is a symlink to a private file', async () => {
    if (process.platform === 'win32') return;
    const outside = await tempDir();
    await writeFile(join(outside, 'id_rsa'), 'PRIVATE');
    const repoStoreDir = await tempDir();
    const s = new PromptStore(repoStoreDir, 'repo');
    const created = await s.create({ body: 'x' });
    await s.addBytes(created.id, Buffer.from('i'), { name: 'shot.png' });
    const target = join(created.dir, 'attachments', 'shot.png');
    await writeFile(`${target}.tmp`, '');
    await import('node:fs/promises').then(fs => fs.rm(target));
    await symlink(join(outside, 'id_rsa'), target);

    const { resolved, missing } = await resolveAttachments(await s.get(created.id), undefined);
    expect(resolved).toEqual([]);
    expect(missing).toMatchObject([{ name: 'shot.png', reason: 'blocked' }]);
  });

  it('blocks a workspace reference through a symlink that leaves the repository', async () => {
    if (process.platform === 'win32') return;
    const outside = await tempDir();
    await writeFile(join(outside, 'secret.txt'), 'PRIVATE');
    const root = await tempDir();
    await symlink(outside, join(root, 'escape'));
    await writeFile(join(root, 'real.ts'), 'fine');
    await symlink(join(root, 'real.ts'), join(root, 'alias.ts'));
    const s = new PromptStore(await tempDir(), 'global');
    const created = await s.create({ body: 'x' });
    await s.addWorkspaceFile(created.id, 'escape/secret.txt');
    await s.addWorkspaceFile(created.id, 'alias.ts');

    const { resolved, missing } = await resolveAttachments(await s.get(created.id), root);
    expect(missing).toMatchObject([{ reason: 'blocked' }]);
    expect(resolved.map(item => item.name)).toEqual(['alias.ts']);
  });

  it('lists attachments in text for text-only surfaces', () => {
    const text = withAttachmentPaths('Do it', {
      resolved: [{ attachment: { kind: 'workspace', path: 'a.ts', range: { startLine: 1, endLine: 2 } }, name: 'a.ts:1-2', absolutePath: '/r/a.ts', image: false, range: { startLine: 1, endLine: 2 } }],
      missing: [{ attachment: { kind: 'workspace', path: 'b.ts' }, name: 'b.ts', reason: 'not-found' }],
    });
    expect(text).toBe('Do it\n\nAttached files:\n- /r/a.ts (lines 1-2)\n- b.ts (missing: the file no longer exists)');
    expect(withAttachmentPaths('Do it', { resolved: [], missing: [] })).toBe('Do it');
  });
});

describe('text helpers', () => {
  it('removes the placeholder that image attachments leave in the chat input', () => {
    expect(cleanChatInputText('Spike A: hello \uFFFC ')).toEqual({ text: 'Spike A: hello', hadAttachmentPlaceholders: true });
    expect(cleanChatInputText('plain')).toEqual({ text: 'plain', hadAttachmentPlaceholders: false });
    expect(cleanChatInputText('\uFFFC').text).toBe('');
  });

  it('parses file references', () => {
    expect(parseFileReference('src/a.ts')).toEqual({ path: 'src/a.ts' });
    expect(parseFileReference('src/a.ts:10')).toEqual({ path: 'src/a.ts', range: { startLine: 10, endLine: 10 } });
    expect(parseFileReference(' src/a.ts:10-20 ')).toEqual({ path: 'src/a.ts', range: { startLine: 10, endLine: 20 } });
    expect(parseFileReference('src/a.ts:20-10')).toEqual({ path: 'src/a.ts' });
  });

  it('makes branch-safe slugs', () => {
    expect(slugify('Fix the Löğin bug!! (again)')).toBe('fix-the-login-bug-again');
    expect(slugify('!!!')).toBe('prompt');
  });
});
