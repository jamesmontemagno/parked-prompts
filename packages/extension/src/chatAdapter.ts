import { withAttachmentPaths, type AttachmentResolution, type ResolvedAttachment } from '@parked-prompts/core';

/**
 * The only file that knows how to reach the chat input. VS Code has no API for it, so
 * this calls internal commands whose shapes can change. Results for each are recorded
 * in docs/spike-results.md; tools/phase0 re-checks them against a new build.
 */
export const CHAT_OPEN = 'workbench.action.chat.open';
export const CHAT_NEW = 'workbench.action.chat.newChat';
/** Only registered in the Agents window, which is how that window is recognized. */
export const AGENTS_NEW_SESSION = 'workbench.action.sessions.newChat';

/** The document schemes of the chat inputs in the editor and the Agents window. */
export const CHAT_INPUT_SCHEMES: ReadonlySet<string> = new Set(['chatSessionInput', 'sessions-chat']);

export interface ChatHost {
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  getCommands(): Thenable<string[]>;
  toUri(path: string): unknown;
}

export type ChatSurface = 'editor' | 'agents-window';
export type RestoreTarget = 'newChat' | 'currentChat';

export const detectSurface = async (host: Pick<ChatHost, 'getCommands'>): Promise<ChatSurface> =>
  (await host.getCommands()).includes(AGENTS_NEW_SESSION) ? 'agents-window' : 'editor';

export interface RestoreRequest {
  text: string;
  attachments: AttachmentResolution;
  mode?: string | undefined;
  model?: string | undefined;
}

export interface RestoreResult {
  surface: ChatSurface;
  /** False when the attachments could only be listed in the text, by path. */
  attachedFiles: boolean;
  /** True when the saved mode or model was not accepted, so the chat's current ones are used. */
  droppedModeOrModel: boolean;
}

function toAttachFile(host: ChatHost, item: ResolvedAttachment): unknown {
  const uri = host.toUri(item.absolutePath);
  if (!item.range) return uri;
  return {
    uri,
    range: { startLineNumber: item.range.startLine, startColumn: 1, endLineNumber: item.range.endLine, endColumn: Number.MAX_SAFE_INTEGER },
  };
}

/** `isPartialQuery` is what keeps `chat.open` from sending. */
export function chatOpenOptions(host: ChatHost, request: RestoreRequest): Record<string, unknown> {
  const { resolved } = request.attachments;
  return {
    query: request.text,
    isPartialQuery: true,
    ...(resolved.length > 0 && { attachFiles: resolved.map(item => toAttachFile(host, item)) }),
    ...(request.mode && { mode: request.mode }),
    ...(request.model && { modelSelector: { id: request.model } }),
  };
}

/**
 * Fills the chat input and never sends.
 *
 * The Agents window registers `chat.open` but it does nothing there. Its own command
 * prefills the composer and takes text only, so attachments go in the text by path.
 * Without `prefillPrompt` that command sends the prompt, so it is always set.
 */
export async function restoreToChat(host: ChatHost, request: RestoreRequest, target: RestoreTarget): Promise<RestoreResult> {
  const surface = await detectSurface(host);
  if (surface === 'agents-window') {
    await host.executeCommand(AGENTS_NEW_SESSION, { prompt: withAttachmentPaths(request.text, request.attachments), prefillPrompt: true });
    return { surface, attachedFiles: request.attachments.resolved.length === 0, droppedModeOrModel: Boolean(request.mode || request.model) };
  }

  if (target === 'newChat') await host.executeCommand(CHAT_NEW);
  const options = chatOpenOptions(host, request);
  try {
    await host.executeCommand(CHAT_OPEN, options);
    return { surface, attachedFiles: true, droppedModeOrModel: false };
  } catch (error) {
    // An unknown model makes the command throw. The text matters more, so retry without.
    if (!request.mode && !request.model) throw error;
    await host.executeCommand(CHAT_OPEN, chatOpenOptions(host, { text: request.text, attachments: request.attachments }));
    return { surface, attachedFiles: true, droppedModeOrModel: true };
  }
}
