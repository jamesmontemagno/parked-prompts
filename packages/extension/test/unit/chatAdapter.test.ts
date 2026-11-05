import { describe, expect, it } from 'vitest';
import type { AttachmentResolution } from '@parked-prompts/core';
import { AGENTS_NEW_SESSION, CHAT_NEW, CHAT_OPEN, restoreToChat, type ChatHost } from '../../src/chatAdapter.ts';

function fakeHost(commands: string[], fail?: (command: string, options: unknown) => boolean) {
  const calls: { command: string; args: unknown[] }[] = [];
  const host: ChatHost = {
    getCommands: async () => commands,
    executeCommand: async (command, ...args) => {
      calls.push({ command, args });
      if (fail?.(command, args[0])) throw new Error('No language models found');
    },
    toUri: path => `uri:${path}`,
  };
  return { host, calls };
}

const editor = [CHAT_OPEN, CHAT_NEW];
const agentsWindow = [CHAT_OPEN, CHAT_NEW, AGENTS_NEW_SESSION];
const none: AttachmentResolution = { resolved: [], missing: [] };
const files: AttachmentResolution = {
  resolved: [
    { attachment: { kind: 'workspace', path: 'src/a.ts' }, name: 'src/a.ts', absolutePath: '/r/src/a.ts', image: false },
    { attachment: { kind: 'workspace', path: 'src/b.ts', range: { startLine: 3, endLine: 9 } }, name: 'src/b.ts:3-9', absolutePath: '/r/src/b.ts', image: false, range: { startLine: 3, endLine: 9 } },
    { attachment: { kind: 'copy', path: 'attachments/s.png', name: 's.png', mime: 'image/png', size: 1, sha256: '' }, name: 's.png', absolutePath: '/h/s.png', image: true },
  ],
  missing: [{ attachment: { kind: 'workspace', path: 'gone.ts' }, name: 'gone.ts', reason: 'not-found' }],
};

describe('restoring in the editor', () => {
  it('opens a new chat first, then fills it without sending', async () => {
    const { host, calls } = fakeHost(editor);
    const result = await restoreToChat(host, { text: 'Do it', attachments: none }, 'newChat');
    expect(calls).toEqual([
      { command: CHAT_NEW, args: [] },
      { command: CHAT_OPEN, args: [{ query: 'Do it', isPartialQuery: true }] },
    ]);
    expect(result).toEqual({ surface: 'editor', attachedFiles: true, droppedModeOrModel: false });
  });

  it('stays in the current chat when asked', async () => {
    const { host, calls } = fakeHost(editor);
    await restoreToChat(host, { text: 'Do it', attachments: none }, 'currentChat');
    expect(calls.map(call => call.command)).toEqual([CHAT_OPEN]);
  });

  it('attaches files, line ranges, and images in the shape the command takes', async () => {
    const { host, calls } = fakeHost(editor);
    await restoreToChat(host, { text: 'Do it', attachments: files }, 'currentChat');
    expect(calls[0]?.args[0]).toEqual({
      query: 'Do it',
      isPartialQuery: true,
      attachFiles: [
        'uri:/r/src/a.ts',
        { uri: 'uri:/r/src/b.ts', range: { startLineNumber: 3, startColumn: 1, endLineNumber: 9, endColumn: Number.MAX_SAFE_INTEGER } },
        'uri:/h/s.png',
      ],
    });
  });

  it('passes the saved mode and model', async () => {
    const { host, calls } = fakeHost(editor);
    await restoreToChat(host, { text: 'x', attachments: none, mode: 'agent', model: 'gpt-x' }, 'currentChat');
    expect(calls[0]?.args[0]).toMatchObject({ mode: 'agent', modelSelector: { id: 'gpt-x' } });
  });

  it('still restores the text when the saved model is not available', async () => {
    const { host, calls } = fakeHost(editor, (_command, options) => Boolean((options as { modelSelector?: unknown }).modelSelector));
    const result = await restoreToChat(host, { text: 'x', attachments: none, mode: 'agent', model: 'gone' }, 'currentChat');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args[0]).toEqual({ query: 'x', isPartialQuery: true });
    expect(result.droppedModeOrModel).toBe(true);
  });

  it('reports a failure it cannot work around', async () => {
    const { host } = fakeHost(editor, () => true);
    await expect(restoreToChat(host, { text: 'x', attachments: none }, 'currentChat')).rejects.toThrow();
  });

  it('never omits isPartialQuery, which is what keeps it from sending', async () => {
    const { host, calls } = fakeHost(editor);
    await restoreToChat(host, { text: 'x', attachments: files, mode: 'agent' }, 'newChat');
    for (const call of calls.filter(item => item.command === CHAT_OPEN)) {
      expect(call.args[0]).toMatchObject({ isPartialQuery: true });
    }
  });
});

describe('restoring in the Agents window', () => {
  it('prefills with the command that works there, and never calls the no-op one', async () => {
    const { host, calls } = fakeHost(agentsWindow);
    await restoreToChat(host, { text: 'Do it', attachments: none }, 'newChat');
    expect(calls).toEqual([{ command: AGENTS_NEW_SESSION, args: [{ prompt: 'Do it', prefillPrompt: true }] }]);
  });

  it('always sets prefillPrompt, because without it the command sends', async () => {
    const { host, calls } = fakeHost(agentsWindow);
    await restoreToChat(host, { text: 'x', attachments: files, mode: 'agent', model: 'm' }, 'currentChat');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toMatchObject({ prefillPrompt: true });
  });

  it('lists attachments by path, and says it could not attach them', async () => {
    const { host, calls } = fakeHost(agentsWindow);
    const result = await restoreToChat(host, { text: 'Do it', attachments: files }, 'newChat');
    const { prompt } = calls[0]!.args[0] as { prompt: string };
    expect(prompt).toContain('Do it\n\nAttached files:');
    expect(prompt).toContain('- /r/src/b.ts (lines 3-9)');
    expect(prompt).toContain('- /h/s.png');
    expect(prompt).toContain('gone.ts (missing');
    expect(result).toMatchObject({ surface: 'agents-window', attachedFiles: false });
  });
});
