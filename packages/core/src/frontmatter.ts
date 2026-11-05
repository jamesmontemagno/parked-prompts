import { parse, stringify } from 'yaml';
import { normalizeRelativePath } from './paths.ts';
import { deriveTitle } from './text.ts';
import {
  PROMPT_STATUSES,
  SCHEMA_VERSION,
  type Attachment,
  type LineRange,
  type PromptMeta,
  type PromptRepo,
  type PromptStatus,
} from './types.ts';

const MAX_TITLE = 200;
const MAX_LABEL = 200;
const ATTACHMENTS_DIR = 'attachments';
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?^---[ \t]*(?:\r?\n|$)/m;

export interface ParsedPrompt {
  meta: PromptMeta;
  body: string;
  warnings: string[];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const boundedString = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined;

const validTime = (value: unknown): string | undefined =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;

function parseRange(value: unknown): LineRange | undefined {
  const range = record(value);
  if (!range) return undefined;
  const { startLine, endLine } = range;
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)) return undefined;
  if ((startLine as number) < 1 || (endLine as number) < (startLine as number)) return undefined;
  return { startLine: startLine as number, endLine: endLine as number };
}

function parseAttachment(value: unknown): Attachment | string {
  const item = record(value);
  if (!item) return 'an attachment is not an object';
  const rawPath = typeof item.path === 'string' ? item.path : '';
  let path: string;
  try {
    path = normalizeRelativePath(rawPath);
  } catch {
    return `attachment path "${rawPath.slice(0, 120)}" is not allowed`;
  }
  if (item.kind === 'workspace') {
    const range = parseRange(item.range);
    return { kind: 'workspace', path, ...(range && { range }) };
  }
  if (item.kind === 'copy') {
    const parts = path.split('/');
    if (parts.length !== 2 || parts[0] !== ATTACHMENTS_DIR) return `attachment path "${path.slice(0, 120)}" is not under ${ATTACHMENTS_DIR}/`;
    return {
      kind: 'copy',
      path,
      name: boundedString(item.name, MAX_TITLE) ?? (parts[1] as string),
      mime: boundedString(item.mime, MAX_LABEL) ?? 'application/octet-stream',
      size: Number.isSafeInteger(item.size) && (item.size as number) >= 0 ? (item.size as number) : 0,
      sha256: typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256) ? item.sha256 : '',
    };
  }
  return `attachment "${path.slice(0, 120)}" has an unknown kind`;
}

function parseRepo(value: unknown): PromptRepo | undefined {
  const repo = record(value);
  if (!repo) return undefined;
  const remote = boundedString(repo.remote, 500);
  const path = boundedString(repo.path, 4096);
  return remote || path ? { ...(remote && { remote }), ...(path && { path }) } : undefined;
}

/**
 * Reads `prompt.md`. A hand-edited or partly damaged file still gives a usable
 * prompt where it can: bad fields fall back to defaults and bad attachments are
 * dropped with a warning. The entry's ID always comes from its folder name, never
 * from the file.
 */
export function parsePrompt(text: string, id: string, fallbackTime: string): ParsedPrompt {
  const warnings: string[] = [];
  const match = FRONTMATTER.exec(text);
  const hasFrontmatter = match?.index === 0;
  let data: Record<string, unknown> = {};
  if (hasFrontmatter) {
    try {
      data = record(parse(match[1] ?? '', { schema: 'core', maxAliasCount: 16 })) ?? {};
    } catch {
      warnings.push('The frontmatter is not valid YAML, so its fields were ignored.');
    }
  }
  const raw = hasFrontmatter ? text.slice(match[0].length) : text;
  const body = raw.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

  const attachments: Attachment[] = [];
  if (Array.isArray(data.attachments)) {
    for (const item of data.attachments) {
      const parsed = parseAttachment(item);
      if (typeof parsed === 'string') warnings.push(parsed);
      else attachments.push(parsed);
    }
  } else if (data.attachments !== undefined) {
    warnings.push('The attachments field is not a list, so it was ignored.');
  }

  const status: PromptStatus = PROMPT_STATUSES.includes(data.status as PromptStatus) ? (data.status as PromptStatus) : 'parked';
  const createdAt = validTime(data.createdAt) ?? fallbackTime;
  const repo = parseRepo(data.repo);
  const mode = boundedString(data.mode, MAX_LABEL);
  const model = boundedString(data.model, MAX_LABEL);
  return {
    meta: {
      id,
      title: boundedString(data.title, MAX_TITLE) ?? deriveTitle(body),
      createdAt,
      updatedAt: validTime(data.updatedAt) ?? createdAt,
      status,
      ...(repo && { repo }),
      ...(mode && { mode }),
      ...(model && { model }),
      attachments,
    },
    body,
    warnings,
  };
}

/** Writes `prompt.md`: YAML frontmatter, a blank line, then the prompt exactly as typed. */
export function serializePrompt(meta: PromptMeta, body: string): string {
  // Fields are picked by name, so nothing about the local machine can slip in with a spread.
  const fields = {
    schema: SCHEMA_VERSION,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    status: meta.status,
    ...(meta.repo && { repo: meta.repo }),
    ...(meta.mode && { mode: meta.mode }),
    ...(meta.model && { model: meta.model }),
    attachments: meta.attachments,
  };
  return `---\n${stringify(fields, { lineWidth: 0 })}---\n\n${body}\n`;
}
