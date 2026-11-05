import * as assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { writePendingRestore, type ParkedPrompt } from '@parked-prompts/core';
import type { ParkedPromptsApi } from '../../src/extension.ts';

const EXTENSION_ID = 'vs-publisher-473885.parked-prompts';
const WORKSPACE = process.env.PARKED_TEST_WORKSPACE as string;

const chatInputs = () => vscode.workspace.textDocuments.filter(document => document.uri.scheme === 'chatSessionInput');

/** Chat is built in, but it takes a moment to create its input after a command returns. */
async function waitForChatText(expected: string, timeoutMs = 15_000): Promise<string> {
  const started = Date.now();
  let seen = '';
  while (Date.now() - started < timeoutMs) {
    seen = chatInputs().map(document => document.getText()).join(' | ');
    if (seen.includes(expected)) return seen;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`The chat input never showed "${expected}". It showed: "${seen}"`);
}

describe('Parked Prompts in VS Code', () => {
  let api: ParkedPromptsApi;

  before(async () => {
    const extension = vscode.extensions.getExtension<ParkedPromptsApi>(EXTENSION_ID);
    assert.ok(extension, 'the extension is installed');
    api = await extension.activate();
  });

  it('activates and registers every contributed command', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const contributed = (extension.packageJSON.contributes.commands as { command: string }[]).map(item => item.command);
    assert.ok(contributed.length >= 10);
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of contributed) assert.ok(registered.has(command), `${command} is registered`);
  });

  it('finds the repository from the open folder', () => {
    assert.equal(api.service.repo?.remote, 'github.com/test/workspace');
    assert.equal(api.service.isGitRepo, true);
    assert.ok(api.service.catalog.repoStore, 'a trusted workspace has a repo store');
  });

  it('the internal chat commands it depends on still exist', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    assert.ok(registered.has('workbench.action.chat.open'));
    assert.ok(registered.has('workbench.action.chat.newChat'));
  });

  describe('restoring', () => {
    let prompt: ParkedPrompt;

    before(async () => {
      prompt = await api.service.catalog.global.create({ title: 'Later', body: 'Restore me into a new chat', repo: { remote: 'github.com/test/workspace' } });
    });

    it('fills a new chat and does not send it', async () => {
      assert.equal(await api.actions.restore({ store: 'global', id: prompt.id }, 'newChat'), true);
      await waitForChatText('Restore me into a new chat');
      // Sending clears the input, so the text still being there a moment later means it was not sent.
      await new Promise(resolve => setTimeout(resolve, 1500));
      await waitForChatText('Restore me into a new chat', 1000);
    });

    it('keeps the prompt, because it cannot see whether you sent it', async () => {
      assert.equal((await api.service.get({ store: 'global', id: prompt.id })).status, 'parked');
    });

    it('restores with attachments, including a file that has gone missing', async () => {
      const withFiles = await api.service.catalog.global.create({ body: 'With attachments', repo: { remote: 'github.com/test/workspace' } });
      await api.service.catalog.global.addWorkspaceFile(withFiles.id, 'src/a.ts', { startLine: 1, endLine: 1 });
      await api.service.catalog.global.addWorkspaceFile(withFiles.id, 'src/missing.ts');
      await api.service.catalog.global.addBytes(withFiles.id, Buffer.from('not really a png'), { name: 'shot.png' });
      const { resolved, missing } = await api.service.attachments(await api.service.get({ store: 'global', id: withFiles.id }));
      assert.deepEqual(resolved.map(item => item.name), ['src/a.ts:1', 'shot.png']);
      assert.deepEqual(missing.map(item => item.name), ['src/missing.ts']);
      assert.equal(await api.actions.restore({ store: 'global', id: withFiles.id }, 'newChat'), true);
      await waitForChatText('With attachments');
    });
  });

  describe('capturing what was typed', () => {
    it('parks the chat input text, without the attachment placeholder', async () => {
      await vscode.commands.executeCommand('workbench.action.chat.newChat');
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: 'Typed in the chat input',
        isPartialQuery: true,
        attachFiles: [vscode.Uri.file(join(WORKSPACE, 'src', 'a.ts'))],
      });
      await waitForChatText('Typed in the chat input');
      const parked = (await vscode.commands.executeCommand('parkedPrompts.parkTyped')) as ParkedPrompt | undefined;
      assert.ok(parked, 'it parked something');
      assert.equal(parked.body, 'Typed in the chat input');
      assert.ok(!parked.body.includes('\uFFFC'));
      assert.equal(parked.repo?.remote, 'github.com/test/workspace');
    });
  });

  describe('a worktree window', () => {
    it('restores a pending prompt once', async () => {
      const prompt = await api.service.catalog.global.create({ body: 'Pending worktree prompt' });
      await writePendingRestore(api.service.home, { ref: { store: 'global', id: prompt.id }, worktreePath: WORKSPACE });
      await api.actions.restorePending();
      await waitForChatText('Pending worktree prompt');
      await vscode.commands.executeCommand('workbench.action.chat.newChat');
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: 'something else', isPartialQuery: true });
      await waitForChatText('something else');
      await api.actions.restorePending();
      await new Promise(resolve => setTimeout(resolve, 500));
      await waitForChatText('something else', 1000);
    });
  });

  describe('the store on disk', () => {
    it('picks up an entry another process wrote, such as the canvas', async () => {
      const other = await api.service.catalog.global.create({ title: 'Original', body: 'x' });
      const file = join(other.dir, 'prompt.md');
      await writeFile(file, '---\ntitle: Changed by the canvas\nstatus: parked\n---\n\nx\n');
      assert.equal((await api.service.get({ store: 'global', id: other.id })).title, 'Changed by the canvas');
    });

    it('lists prompts in the repo store of a trusted workspace', async () => {
      const shared = await api.service.catalog.repoStore?.create({ body: 'Shared by Git' });
      assert.ok(shared);
      const { prompts } = await api.service.list('repo');
      assert.ok(prompts.some(item => item.store === 'repo' && item.id === shared.id));
      assert.equal(await api.service.catalog.trust.needsConfirmation(shared), true);
    });
  });
});
