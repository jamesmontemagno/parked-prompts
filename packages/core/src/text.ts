import type { LineRange } from './types.ts';

const MAX_TITLE = 120;

/** A title from the first line with text, for prompts the user did not name. */
export function deriveTitle(body: string): string {
  const line = body.split(/\r?\n/).map(value => value.trim()).find(value => value.length > 0) ?? '';
  const plain = line.replace(/^#+\s*/, '');
  if (plain.length === 0) return 'Untitled prompt';
  return plain.length <= MAX_TITLE ? plain : `${plain.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

export function excerpt(body: string, length = 160): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1).trimEnd()}…`;
}

export function slugify(text: string, maxLength = 40): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'prompt';
}

/** Parses `src/a.ts`, `src/a.ts:10`, or `src/a.ts:10-20`. */
export function parseFileReference(input: string): { path: string; range?: LineRange } {
  const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(input.trim());
  if (!match?.[1] || !match[2]) return { path: input.trim() };
  const startLine = Number(match[2]);
  const endLine = match[3] ? Number(match[3]) : startLine;
  if (startLine < 1 || endLine < startLine) return { path: match[1] };
  return { path: match[1], range: { startLine, endLine } };
}

export const formatFileReference = (path: string, range?: LineRange): string =>
  !range ? path : range.startLine === range.endLine ? `${path}:${range.startLine}` : `${path}:${range.startLine}-${range.endLine}`;

/** The chat input holds this character where an image attachment sits. */
const ATTACHMENT_PLACEHOLDER = /\uFFFC/g;

/** Plain text from a chat input document, with attachment placeholders removed. */
export function cleanChatInputText(text: string): { text: string; hadAttachmentPlaceholders: boolean } {
  const hadAttachmentPlaceholders = text.includes('\uFFFC');
  return { text: text.replace(ATTACHMENT_PLACEHOLDER, '').trim(), hadAttachmentPlaceholders };
}
