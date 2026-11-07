import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptCatalog, PromptStore, type ParkedPrompt, type PromptRef } from '@parked-prompts/core';
import type { ParkedService } from '../../src/service.ts';
import type { PromptPreview } from '../../src/trustFlow.ts';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  writeText: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: { onDidChangeTextDocument: () => ({ dispose() {} }) },
  env: { clipboard: { writeText: mocks.writeText } },
  window: { showWarningMessage: mocks.warning, showInformationMessage: mocks.info, showErrorMessage: mocks.error },
}));
vi.mock('../../src/trustFlow.ts', () => ({ confirmRepoPrompt: mocks.confirm }));

import { PromptActions } from '../../src/actions.ts';

const prompt = (store: PromptRef['store']): ParkedPrompt => ({
  id: 'later',
  title: 'Later',
  body: 'Full prompt\nwith multiple lines',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  store,
  dir: '/example/later',
  attachments: [],
  warnings: [],
});

describe('copying a prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.writeText.mockResolvedValue(undefined);
  });

  it('copies the complete text without changing its status', async () => {
    const saved = prompt('global');
    const get: ParkedService['get'] = vi.fn().mockResolvedValue(saved);
    const service = { get } as ParkedService;
    const preview = {} as PromptPreview;
    const actions = new PromptActions(service, preview);

    expect(await actions.copy({ store: 'global', id: saved.id })).toBe(true);
    expect(get).toHaveBeenCalledWith({ store: 'global', id: saved.id });
    expect(mocks.confirm).toHaveBeenCalledWith(service, preview, saved);
    expect(mocks.writeText).toHaveBeenCalledWith(saved.body);
    expect(saved.status).toBe('draft');
    actions.dispose();
  });

  it('does not copy a repository prompt when its review is declined', async () => {
    const saved = prompt('repo');
    const get: ParkedService['get'] = vi.fn().mockResolvedValue(saved);
    const service = { get } as ParkedService;
    const actions = new PromptActions(service, {} as PromptPreview);
    mocks.confirm.mockResolvedValue(false);

    expect(await actions.copy({ store: 'repo', id: saved.id })).toBe(false);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.writeText).not.toHaveBeenCalled();
    actions.dispose();
  });

  it('copies a repository prompt only after review succeeds', async () => {
    const saved = prompt('repo');
    const get: ParkedService['get'] = vi.fn().mockResolvedValue(saved);
    const service = { get } as ParkedService;
    const preview = {} as PromptPreview;
    const actions = new PromptActions(service, preview);

    expect(await actions.copy({ store: 'repo', id: saved.id })).toBe(true);
    expect(mocks.confirm).toHaveBeenCalledWith(service, preview, saved);
    expect(mocks.writeText).toHaveBeenCalledWith(saved.body);
    actions.dispose();
  });

  it('surfaces clipboard failures', async () => {
    const saved = prompt('global');
    const get: ParkedService['get'] = vi.fn().mockResolvedValue(saved);
    const service = { get } as ParkedService;
    const actions = new PromptActions(service, {} as PromptPreview);
    mocks.writeText.mockRejectedValue(new Error('Clipboard unavailable'));

    await expect(actions.copy({ store: 'global', id: saved.id })).rejects.toThrow('Clipboard unavailable');
    actions.dispose();
  });
});

describe('deleting from a row', () => {
  it('keeps the prompt when deletion is cancelled', async () => {
    const saved = prompt('repo');
    const get: ParkedService['get'] = vi.fn().mockResolvedValue(saved);
    const actions = new PromptActions({ get } as ParkedService, {} as PromptPreview);
    mocks.warning.mockResolvedValue(undefined);

    expect(await actions.delete({ store: 'repo', id: saved.id })).toBe(false);
    expect(mocks.warning).toHaveBeenCalledWith(
      'Delete "Later" and its attachments?',
      expect.objectContaining({ modal: true, detail: expect.stringContaining('working copy') }),
      'Delete',
    );
    actions.dispose();
  });

  it('deletes only after the user confirms', async () => {
    const saved = prompt('global');
    const store = new PromptStore('/unused', 'global');
    const remove = vi.spyOn(store, 'delete').mockResolvedValue(undefined);
    const get: ParkedService['get'] = vi.fn().mockResolvedValue(saved);
    const fire: ParkedService['fire'] = vi.fn();
    const catalog = new PromptCatalog({ home: '/unused' });
    vi.spyOn(catalog, 'storeFor').mockReturnValue(store);
    const actions = new PromptActions({ get, fire, catalog } as ParkedService, {} as PromptPreview);
    mocks.warning.mockResolvedValue('Delete');

    expect(await actions.delete({ store: 'global', id: saved.id })).toBe(true);
    expect(remove).toHaveBeenCalledWith(saved.id);
    expect(fire).toHaveBeenCalledOnce();
    actions.dispose();
  });
});

describe('clearing completed prompts', () => {
  let root: string;
  let catalog: PromptCatalog;
  let fire: ReturnType<typeof vi.fn>;
  let actions: PromptActions;

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(join(tmpdir(), 'parked-clear-'));
    catalog = new PromptCatalog({ home: root });
    fire = vi.fn();
    const service = { catalog, get: (ref: PromptRef) => catalog.storeFor(ref.store).get(ref.id), fire } as unknown as ParkedService;
    actions = new PromptActions(service, {} as PromptPreview);
  });

  afterEach(async () => {
    actions.dispose();
    await rm(root, { recursive: true, force: true });
  });

  const done = async (title: string) => catalog.global.create({ title, body: title, status: 'done' });

  it('deletes the selected completed prompts after confirmation', async () => {
    const a = await done('A');
    const b = await done('B');
    mocks.warning.mockResolvedValue('Delete');

    expect(await actions.clearDone([{ store: 'global', id: a.id }, { store: 'global', id: b.id }])).toEqual({ cleared: 2, changed: 0, failed: 0 });
    expect(mocks.warning).toHaveBeenCalledWith('Delete 2 completed prompts and their copied attachments?', expect.objectContaining({ modal: true }), 'Delete');
    expect((await catalog.global.list()).prompts).toHaveLength(0);
    expect(fire).toHaveBeenCalled();
  });

  it('keeps everything when the confirmation is dismissed', async () => {
    const a = await done('A');
    mocks.warning.mockResolvedValue(undefined);

    expect(await actions.clearDone([{ store: 'global', id: a.id }])).toBeUndefined();
    expect((await catalog.global.list()).prompts).toHaveLength(1);
  });

  it('keeps a prompt that was edited or reopened while the dialog was open', async () => {
    const edited = await done('Edited');
    const reopened = await done('Reopened');
    const plain = await done('Plain');
    mocks.warning.mockImplementation(async () => {
      await catalog.global.update(edited.id, { body: 'changed' });
      await catalog.global.update(reopened.id, { status: 'parked' });
      return 'Delete';
    });

    const refs = [edited, reopened, plain].map(prompt => ({ store: 'global' as const, id: prompt.id }));
    expect(await actions.clearDone(refs)).toEqual({ cleared: 1, changed: 2, failed: 0 });
    expect((await catalog.global.list()).prompts.map(prompt => prompt.title).sort()).toEqual(['Edited', 'Reopened']);
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('2 prompts were kept'));
  });

  it('does not ask when nothing selected is still done', async () => {
    const parked = await catalog.global.create({ title: 'Parked', body: 'x', status: 'parked' });

    expect(await actions.clearDone([{ store: 'global', id: parked.id }, { store: 'global', id: 'missing' }])).toBeUndefined();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect((await catalog.global.list()).prompts).toHaveLength(1);
  });
});
