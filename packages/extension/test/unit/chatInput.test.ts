import { describe, expect, it } from 'vitest';
import { chatInputCandidates, chooseChatInput, type ChatInputDocument } from '../../src/chatInput.ts';

const doc = (uri: string, text: string): ChatInputDocument => ({ uri: { scheme: uri.split(':')[0] as string, toString: () => uri }, getText: () => text });

describe('reading the chat input', () => {
  it('reads both chat input schemes and nothing else', () => {
    const found = chatInputCandidates([doc('chatSessionInput:input-0', 'a'), doc('sessions-chat:x', 'b'), doc('file:///a.ts', 'c'), doc('untitled:1', 'd')]);
    expect(found.map(item => item.text)).toEqual(['a', 'b']);
  });

  it('removes attachment placeholders and skips inputs with nothing else in them', () => {
    const found = chatInputCandidates([doc('chatSessionInput:input-0', 'Hello \uFFFC '), doc('chatSessionInput:input-1', ' \uFFFC '), doc('chatSessionInput:input-2', '')]);
    expect(found).toEqual([{ uri: 'chatSessionInput:input-0', text: 'Hello', hadAttachmentPlaceholders: true }]);
  });
});

describe('choosing which input to park', () => {
  const a = { uri: 'chatSessionInput:input-0', text: 'first', hadAttachmentPlaceholders: false };
  const b = { uri: 'chatSessionInput:input-1', text: 'second', hadAttachmentPlaceholders: false };

  it('has nothing to choose from an empty list', () => {
    expect(chooseChatInput([], undefined)).toEqual({ kind: 'none' });
  });

  it('takes the only one', () => {
    expect(chooseChatInput([a], undefined)).toEqual({ kind: 'one', candidate: a });
  });

  it('treats inputs with the same text as one, because a new chat copies its draft', () => {
    expect(chooseChatInput([a, { ...a, uri: 'chatSessionInput:input-9' }], undefined)).toMatchObject({ kind: 'one' });
  });

  it('prefers the input edited last', () => {
    expect(chooseChatInput([a, b], b.uri)).toEqual({ kind: 'one', candidate: b });
  });

  it('asks when there are several and no signal, rather than guessing', () => {
    expect(chooseChatInput([a, b], undefined)).toEqual({ kind: 'ambiguous', candidates: [a, b] });
    expect(chooseChatInput([a, b], 'chatSessionInput:gone')).toMatchObject({ kind: 'ambiguous' });
  });
});
