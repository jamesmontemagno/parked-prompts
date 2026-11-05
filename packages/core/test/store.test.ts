import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROMPT_FILE, PromptStore, parsePrompt, serializePrompt, type PromptMeta } from '../src/index.ts';
import { tempDir } from './helpers.ts';

const meta: PromptMeta = {
  id: 'abc',
  title: 'A prompt',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  status: 'parked',
  attachments: [],
};

describe('prompt.md format', () => {
  it.each([
    ['plain text', 'Fix the bug'],
    ['leading and trailing blank lines', '\n\nbody\n\n'],
    ['an empty prompt', ''],
    ['a horizontal rule that looks like frontmatter', 'one\n---\ntwo\n---\nthree'],
    ['frontmatter-like text at the start', '---\ntitle: not this\n---\nbody'],
    ['unicode', 'héllo 世界 🎉'],
    ['CRLF inside the body', 'a\r\nb'],
  ])('round trips %s', (_name, body) => {
    const parsed = parsePrompt(serializePrompt(meta, body), 'abc', meta.createdAt);
    expect(parsed.body).toBe(body);
    expect(parsed.meta.title).toBe('A prompt');
    expect(parsed.warnings).toEqual([]);
  });

  it('never writes machine details from a spread', () => {
    const leaky = { ...meta, dir: '/home/me/secret', body: 'x', store: 'global', warnings: ['y'] } as PromptMeta;
    const text = serializePrompt(leaky, 'body');
    expect(text).not.toContain('/home/me/secret');
    expect(text).not.toContain('store:');
    expect(text).not.toContain('warnings');
  });

  it('takes the ID from the folder, not the file', () => {
    const text = '---\nid: ../../evil\ntitle: T\n---\n\nbody\n';
    expect(parsePrompt(text, 'folder-id', meta.createdAt).meta.id).toBe('folder-id');
  });

  it('reads a file with no frontmatter as all body', () => {
    const parsed = parsePrompt('Just some text\nand more', 'x', meta.createdAt);
    expect(parsed.body).toBe('Just some text\nand more');
    expect(parsed.meta.title).toBe('Just some text');
    expect(parsed.meta.status).toBe('parked');
  });

  it('survives invalid YAML and says so', () => {
    const parsed = parsePrompt('---\ntitle: [unclosed\n---\n\nbody\n', 'x', meta.createdAt);
    expect(parsed.body).toBe('body');
    expect(parsed.warnings[0]).toContain('not valid YAML');
  });

  it('falls back on bad field types', () => {
    const parsed = parsePrompt('---\ntitle: 5\nstatus: launched\ncreatedAt: soon\nattachments: nope\n---\n\nHello\n', 'x', '2026-03-03T00:00:00.000Z');
    expect(parsed.meta).toMatchObject({ title: 'Hello', status: 'parked', createdAt: '2026-03-03T00:00:00.000Z', attachments: [] });
    expect(parsed.warnings).toHaveLength(1);
  });

  it('drops attachments that try to leave their folder', () => {
    const text = [
      '---',
      'attachments:',
      '  - { kind: copy, path: ../../.ssh/id_rsa, name: key }',
      '  - { kind: copy, path: attachments/../../x, name: x }',
      '  - { kind: copy, path: other/x.png, name: x }',
      '  - { kind: workspace, path: /etc/passwd }',
      '  - { kind: workspace, path: "C:\\\\Windows\\\\win.ini" }',
      '  - { kind: workspace, path: ../outside.ts }',
      '  - { kind: weird, path: a.ts }',
      '  - just a string',
      '  - { kind: copy, path: attachments/ok.png, name: ok.png, size: 3 }',
      '  - { kind: workspace, path: src/ok.ts, range: { startLine: 2, endLine: 5 } }',
      '  - { kind: workspace, path: src/badrange.ts, range: { startLine: 9, endLine: 1 } }',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    const parsed = parsePrompt(text, 'x', meta.createdAt);
    expect(parsed.meta.attachments.map(a => a.path)).toEqual(['attachments/ok.png', 'src/ok.ts', 'src/badrange.ts']);
    expect(parsed.meta.attachments[1]).toMatchObject({ range: { startLine: 2, endLine: 5 } });
    expect(parsed.meta.attachments[2]).not.toHaveProperty('range');
    expect(parsed.warnings).toHaveLength(8);
  });
});

describe('PromptStore', () => {
  const store = async () => new PromptStore(await tempDir(), 'global');

  it('round trips a prompt with attachments through the disk', async () => {
    const s = await store();
    const created = await s.create({ title: 'Later', body: 'Do the thing', mode: 'agent', model: 'gpt', repo: { remote: 'github.com/o/r', path: '/w/r' } });
    await s.addBytes(created.id, Buffer.from('png-bytes'), { name: 'shot.png', mime: 'image/png' });
    await s.addWorkspaceFile(created.id, 'src/a.ts', { startLine: 3, endLine: 9 });
    const read = await s.get(created.id);
    expect(read).toMatchObject({ title: 'Later', body: 'Do the thing', mode: 'agent', model: 'gpt', status: 'parked', store: 'global', repo: { remote: 'github.com/o/r', path: '/w/r' } });
    expect(read.attachments).toEqual([
      { kind: 'copy', path: 'attachments/shot.png', name: 'shot.png', mime: 'image/png', size: 9, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { kind: 'workspace', path: 'src/a.ts', range: { startLine: 3, endLine: 9 } },
    ]);
    expect(await readFile(join(created.dir, 'attachments/shot.png'), 'utf8')).toBe('png-bytes');
  });

  it('derives a title, and goes back to deriving when it is cleared', async () => {
    const s = await store();
    const created = await s.create({ body: '# Fix login\n\nDetails' });
    expect(created.title).toBe('Fix login');
    const named = await s.update(created.id, { title: 'Named' });
    expect(named.title).toBe('Named');
    expect((await s.update(created.id, { title: '  ', body: 'New first line' })).title).toBe('New first line');
  });

  it('does not touch updatedAt when nothing changed', async () => {
    let time = 1000;
    const s = new PromptStore(await tempDir(), 'global', { now: () => new Date(time) });
    const created = await s.create({ body: 'same' });
    time = 5000;
    expect((await s.update(created.id, { body: 'same' })).updatedAt).toBe(created.updatedAt);
    expect((await s.update(created.id, { body: 'different' })).updatedAt).toBe(new Date(5000).toISOString());
  });

  it('clears the mode and model when given empty values', async () => {
    const s = await store();
    const created = await s.create({ body: 'x', mode: 'agent', model: 'm' });
    const cleared = await s.update(created.id, { mode: '', model: '' });
    expect(cleared.mode).toBeUndefined();
    expect(cleared.model).toBeUndefined();
    expect(await readFile(join(created.dir, PROMPT_FILE), 'utf8')).not.toContain('mode:');
  });

  it('makes global entries private to the user', async () => {
    if (process.platform === 'win32') return;
    const s = await store();
    const created = await s.create({ body: 'private' });
    expect((await stat(join(created.dir, PROMPT_FILE))).mode & 0o777).toBe(0o600);
    expect((await stat(created.dir)).mode & 0o777).toBe(0o700);
  });

  it('leaves no temporary files after creating and updating', async () => {
    const s = await store();
    const created = await s.create({ body: 'x' });
    await s.update(created.id, { body: 'y' });
    expect(await readdir(s.root)).toEqual([created.id]);
    expect((await readdir(created.dir)).sort()).toEqual(['attachments', PROMPT_FILE]);
  });

  it('keeps concurrent attachment changes from different writers', async () => {
    const root = await tempDir();
    const [a, b] = [new PromptStore(root, 'global'), new PromptStore(root, 'global')];
    const created = await a.create({ body: 'x' });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).addBytes(created.id, Buffer.from(`f${i}`), { name: 'f.txt' })),
    );
    const read = await a.get(created.id);
    expect(read.attachments).toHaveLength(8);
    expect(new Set(read.attachments.map(item => item.path)).size).toBe(8);
  });

  it('refuses IDs that could leave the store', async () => {
    const s = await store();
    for (const id of ['../x', 'a/b', '', '.hidden', 'A', 'a\\b']) {
      await expect(s.get(id)).rejects.toMatchObject({ code: 'invalid_id' });
      await expect(s.delete(id)).rejects.toMatchObject({ code: 'invalid_id' });
    }
  });

  it('deletes an entry completely, and only that entry', async () => {
    const s = await store();
    const [a, b] = [await s.create({ body: 'a' }, 'aaa'), await s.create({ body: 'b' }, 'bbb')];
    await s.delete(a.id);
    await expect(s.get(a.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await s.get(b.id)).body).toBe('b');
    expect(await readdir(s.root)).toEqual(['bbb']);
  });

  it('removes one attachment, deleting its copy', async () => {
    const s = await store();
    const created = await s.create({ body: 'x' });
    await s.addBytes(created.id, Buffer.from('1'), { name: 'one.txt' });
    await s.addWorkspaceFile(created.id, 'src/a.ts');
    await s.addWorkspaceFile(created.id, 'src/a.ts', { startLine: 1, endLine: 2 });
    await s.removeAttachment(created.id, 'attachments/one.txt');
    await s.removeAttachment(created.id, 'src/a.ts');
    const read = await s.get(created.id);
    expect(read.attachments).toEqual([{ kind: 'workspace', path: 'src/a.ts', range: { startLine: 1, endLine: 2 } }]);
    expect(await readdir(join(created.dir, 'attachments'))).toEqual([]);
  });

  it('does not add the same workspace reference twice', async () => {
    const s = await store();
    const created = await s.create({ body: 'x' });
    await s.addWorkspaceFile(created.id, './src//a.ts');
    await s.addWorkspaceFile(created.id, 'src/a.ts');
    expect((await s.get(created.id)).attachments).toHaveLength(1);
  });

  it('keeps stored names unique and safe', async () => {
    const s = await store();
    const created = await s.create({ body: 'x' });
    await s.addBytes(created.id, Buffer.from('1'), { name: 'shot.png' });
    await s.addBytes(created.id, Buffer.from('2'), { name: 'SHOT.png' });
    await s.addBytes(created.id, Buffer.from('3'), { name: '../../../etc/passwd' });
    await s.addBytes(created.id, Buffer.from('4'), { name: '.bashrc' });
    const read = await s.get(created.id);
    expect(read.attachments.map(item => item.path)).toEqual(['attachments/shot.png', 'attachments/SHOT-2.png', 'attachments/passwd', 'attachments/bashrc']);
  });

  it('enforces the size and count limits before writing', async () => {
    const s = new PromptStore(await tempDir(), 'global', { limits: { maxAttachmentBytes: 10, maxTotalBytes: 15, maxAttachments: 3 } });
    const created = await s.create({ body: 'x' });
    await expect(s.addBytes(created.id, Buffer.alloc(11), { name: 'big.bin' })).rejects.toMatchObject({ code: 'too_large' });
    await s.addBytes(created.id, Buffer.alloc(10), { name: 'a.bin' });
    await expect(s.addBytes(created.id, Buffer.alloc(6), { name: 'b.bin' })).rejects.toMatchObject({ code: 'too_large' });
    await s.addWorkspaceFile(created.id, 'a.ts');
    await s.addWorkspaceFile(created.id, 'b.ts');
    await expect(s.addWorkspaceFile(created.id, 'c.ts')).rejects.toMatchObject({ code: 'too_many' });
    expect(await readdir(join(created.dir, 'attachments'))).toEqual(['a.bin']);
  });

  it('refuses a source that is not a file', async () => {
    const s = await store();
    const created = await s.create({ body: 'x' });
    await expect(s.addFile(created.id, created.dir)).rejects.toMatchObject({ code: 'not_found' });
    await expect(s.addFile(created.id, '/no/such/file')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses text past the limit', async () => {
    const s = new PromptStore(await tempDir(), 'global', { limits: { maxPromptBytes: 10000 } });
    await expect(s.create({ body: 'x'.repeat(20000) })).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('listing tolerates bad entries', () => {
  it('reports each bad entry and returns the good ones', async () => {
    const root = await tempDir();
    const s = new PromptStore(root, 'global', { limits: { maxPromptBytes: 20000 } });
    await s.create({ body: 'good' }, 'good-one');

    await mkdir(join(root, 'partial-no-file'));
    await mkdir(join(root, 'Bad Folder Name'));
    await writeFile(join(root, 'stray-file.txt'), 'ignored');
    await mkdir(join(root, 'oversize'));
    await writeFile(join(root, 'oversize', PROMPT_FILE), 'x'.repeat(30000));
    await mkdir(join(root, '.tmp-hidden'));
    await mkdir(join(root, 'binary'));
    await writeFile(join(root, 'binary', PROMPT_FILE), Buffer.from([0xff, 0xfe, 0x00, 0x01]));

    const { prompts, problems } = await s.list();
    expect(prompts.map(p => p.id).sort()).toEqual(['binary', 'good-one']);
    expect(problems.map(p => p.id)).toEqual(['Bad Folder Name', 'oversize', 'partial-no-file']);
    expect(problems.find(p => p.id === 'partial-no-file')?.reason).toContain('has no prompt.md');
  });

  it('refuses entries and files that are symlinks', async () => {
    if (process.platform === 'win32') return;
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, 'secret.md'), 'top secret');
    await symlink(outside, join(root, 'linked-dir'));
    await mkdir(join(root, 'linked-file'));
    await symlink(join(outside, 'secret.md'), join(root, 'linked-file', PROMPT_FILE));

    const { prompts, problems } = await new PromptStore(root, 'repo').list();
    expect(prompts).toEqual([]);
    expect(problems.map(p => p.id)).toEqual(['linked-dir', 'linked-file']);
  });

  it('gives an empty list when the store does not exist yet', async () => {
    const s = new PromptStore(join(await tempDir(), 'not-yet'), 'global');
    expect(await s.list()).toEqual({ prompts: [], problems: [] });
  });

  it('sorts newest first', async () => {
    let time = 1000;
    const s = new PromptStore(await tempDir(), 'global', { now: () => new Date(time) });
    await s.create({ body: 'old' }, 'old-one');
    time = 9000;
    await s.create({ body: 'new' }, 'new-one');
    expect((await s.list()).prompts.map(p => p.id)).toEqual(['new-one', 'old-one']);
  });
});
