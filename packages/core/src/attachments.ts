import { lstat, stat } from 'node:fs/promises';
import { extname, relative, sep } from 'node:path';
import { formatFileReference } from './text.ts';
import { isInside, realpathInside, resolveInside } from './paths.ts';
import type { Attachment, LineRange, ParkedPrompt } from './types.ts';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.zip': 'application/zip',
};

/** The formats VS Code's chat attaches as images rather than as files. */
const CHAT_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

export const mimeFromName = (name: string): string => MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? 'application/octet-stream';
export const isImageFile = (name: string): boolean => CHAT_IMAGE_EXTENSIONS.has(extname(name).toLowerCase());

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

/** A pasted image has no name, and some have the wrong extension. */
export function pastedImageName(mime: string, when: Date = new Date()): string {
  const stamp = when.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return `pasted-${stamp}${IMAGE_EXTENSION_BY_MIME[mime] ?? '.png'}`;
}

/**
 * How a picked file is kept: images and files outside the workspace are copied in;
 * other workspace files stay references, so restoring attaches their current version.
 */
export function classifyFile(absolutePath: string, repoRoot: string | undefined): { kind: 'copy' } | { kind: 'workspace'; path: string } {
  if (isImageFile(absolutePath) || !repoRoot || !isInside(repoRoot, absolutePath)) return { kind: 'copy' };
  return { kind: 'workspace', path: relative(repoRoot, absolutePath).split(sep).join('/') };
}

export type MissingReason = 'no-workspace' | 'not-found' | 'blocked';

export interface ResolvedAttachment {
  attachment: Attachment;
  /** The name to show. */
  name: string;
  absolutePath: string;
  image: boolean;
  range?: LineRange;
}

export interface MissingAttachment {
  attachment: Attachment;
  name: string;
  reason: MissingReason;
}

export interface AttachmentResolution {
  resolved: ResolvedAttachment[];
  missing: MissingAttachment[];
}

export const attachmentLabel = (attachment: Attachment): string =>
  attachment.kind === 'copy' ? attachment.name : formatFileReference(attachment.path, attachment.range);

export const missingReasonText = (reason: MissingReason): string =>
  reason === 'no-workspace'
    ? 'no matching workspace is open'
    : reason === 'blocked'
      ? 'it points outside its folder, so it was blocked'
      : 'the file no longer exists';

async function resolveOne(prompt: ParkedPrompt, attachment: Attachment, repoRoot: string | undefined): Promise<ResolvedAttachment | MissingReason> {
  const root = attachment.kind === 'copy' ? prompt.dir : repoRoot;
  if (!root) return 'no-workspace';
  let target: string;
  try {
    target = resolveInside(root, attachment.path);
  } catch {
    return 'blocked';
  }
  const link = await lstat(target).catch(() => undefined);
  if (!link) return 'not-found';
  // An attached copy is ours, so it is never a symlink. One that is came from somewhere else, such as a Git pull.
  if (attachment.kind === 'copy' && link.isSymbolicLink()) return 'blocked';
  let real: string;
  try {
    real = await realpathInside(root, target);
  } catch {
    return 'blocked';
  }
  const info = await stat(real).catch(() => undefined);
  if (!info?.isFile()) return 'not-found';
  return {
    attachment,
    name: attachmentLabel(attachment),
    absolutePath: real,
    image: isImageFile(real),
    ...(attachment.kind === 'workspace' && attachment.range && { range: attachment.range }),
  };
}

/** Finds each attachment on disk, flagging what is missing or not allowed instead of failing. */
export async function resolveAttachments(prompt: ParkedPrompt, repoRoot: string | undefined): Promise<AttachmentResolution> {
  const resolution: AttachmentResolution = { resolved: [], missing: [] };
  for (const attachment of prompt.attachments) {
    const result = await resolveOne(prompt, attachment, repoRoot);
    if (typeof result === 'string') resolution.missing.push({ attachment, name: attachmentLabel(attachment), reason: result });
    else resolution.resolved.push(result);
  }
  return resolution;
}

/**
 * The prompt text with its attachments listed by path, for surfaces that can only
 * take text: the Agents window composer, and as a backstop when sending from a canvas.
 */
export function withAttachmentPaths(body: string, resolution: AttachmentResolution): string {
  if (resolution.resolved.length === 0 && resolution.missing.length === 0) return body;
  const lines = resolution.resolved.map(item => {
    const range = item.range ? ` (lines ${item.range.startLine}-${item.range.endLine})` : '';
    return `- ${item.absolutePath}${range}`;
  });
  for (const item of resolution.missing) lines.push(`- ${item.name} (missing: ${missingReasonText(item.reason)})`);
  return `${body}\n\nAttached files:\n${lines.join('\n')}`;
}
