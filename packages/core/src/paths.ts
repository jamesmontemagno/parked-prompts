import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ParkedPromptsError } from './errors.ts';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
// eslint-disable-next-line no-control-regex -- control characters are what this rejects.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const MAX_FILE_NAME = 120;

/** The global store. `PARKED_PROMPTS_HOME` overrides it, for tests and unusual setups. */
export const defaultHome = (): string => process.env.PARKED_PROMPTS_HOME || join(homedir(), '.parked-prompts');

/** The repo store of a checkout. */
export const repoStoreRoot = (repoRoot: string): string => join(repoRoot, '.github', 'parked-prompts');

export const isValidId = (id: string): boolean => ID_PATTERN.test(id);

export function assertValidId(id: string): void {
  if (!isValidId(id)) throw new ParkedPromptsError('invalid_id', `"${id.slice(0, 80)}" is not a valid prompt ID.`);
}

/** A sortable, unique ID such as `20261105-160520-a1b2c3`. */
export function newPromptId(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/**
 * Checks a path from a prompt file or a page and returns it in POSIX form, relative
 * to its root. Anything that could leave the root is refused.
 */
export function normalizeRelativePath(input: string): string {
  const reject = () => new ParkedPromptsError('path_escape', `"${input.slice(0, 200)}" is not a path inside the folder.`);
  if (input.length === 0 || input.length > 4096 || input.includes('\0')) throw reject();
  const posix = input.replace(/\\/g, '/');
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) throw reject();
  const parts: string[] = [];
  for (const part of posix.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw reject();
    parts.push(part);
  }
  if (parts.length === 0) throw reject();
  return parts.join('/');
}

/** Joins a checked relative path onto a root. This does not look at symlinks; see `realpathInside`. */
export function resolveInside(root: string, relativePath: string): string {
  const target = resolve(root, normalizeRelativePath(relativePath));
  if (!isInside(resolve(root), target)) {
    throw new ParkedPromptsError('path_escape', `"${relativePath.slice(0, 200)}" is outside the folder.`);
  }
  return target;
}

/** Follows symlinks and refuses a target that ends up outside the root. */
export async function realpathInside(root: string, target: string): Promise<string> {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (!isInside(realRoot, realTarget)) {
    throw new ParkedPromptsError('path_escape', `"${target}" resolves outside the folder.`);
  }
  return realTarget;
}

/** Makes a name from the user or a page safe to use as one file name. */
export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.replace(CONTROL_CHARACTERS, '').replace(/[<>:"|?*]/g, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  const safe = cleaned.length === 0 || WINDOWS_RESERVED.test(cleaned) ? `file-${cleaned}`.replace(/-$/, '') : cleaned;
  if (safe.length <= MAX_FILE_NAME) return safe;
  const dot = safe.lastIndexOf('.');
  const extension = dot > 0 && safe.length - dot <= 16 ? safe.slice(dot) : '';
  return safe.slice(0, MAX_FILE_NAME - extension.length) + extension;
}

/** The first free variant of a name: `shot.png`, `shot-2.png`, ... */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map(value => value.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}${extension}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}
