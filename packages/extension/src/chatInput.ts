import { cleanChatInputText } from '@parked-prompts/core';
import { CHAT_INPUT_SCHEMES } from './chatAdapter.ts';

export interface ChatInputDocument {
  uri: { scheme: string; toString(): string };
  getText(): string;
}

export interface ChatInputCandidate {
  uri: string;
  text: string;
  hadAttachmentPlaceholders: boolean;
}

/** What chat inputs hold right now. Inputs with only whitespace or placeholders do not count. */
export function chatInputCandidates(documents: readonly ChatInputDocument[]): ChatInputCandidate[] {
  const candidates: ChatInputCandidate[] = [];
  for (const document of documents) {
    if (!CHAT_INPUT_SCHEMES.has(document.uri.scheme)) continue;
    const { text, hadAttachmentPlaceholders } = cleanChatInputText(document.getText());
    if (text) candidates.push({ uri: document.uri.toString(), text, hadAttachmentPlaceholders });
  }
  return candidates;
}

export type ChatInputChoice =
  | { kind: 'none' }
  | { kind: 'one'; candidate: ChatInputCandidate }
  | { kind: 'ambiguous'; candidates: ChatInputCandidate[] };

/**
 * Chooses which input the user means. VS Code does not say which chat input has focus
 * (`activeTextEditor` stays empty), so the best signal is the one edited last. With
 * several and no signal, the caller asks rather than guesses.
 */
export function chooseChatInput(candidates: readonly ChatInputCandidate[], lastEditedUri: string | undefined): ChatInputChoice {
  const distinct = [...new Map(candidates.map(candidate => [candidate.text, candidate])).values()];
  const [first] = distinct;
  if (!first) return { kind: 'none' };
  if (distinct.length === 1) return { kind: 'one', candidate: first };
  const edited = candidates.find(candidate => candidate.uri === lastEditedUri);
  return edited ? { kind: 'one', candidate: edited } : { kind: 'ambiguous', candidates: distinct };
}
