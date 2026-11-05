import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWriteFile, pathExists, withLock } from './fsutil.ts';
import { isValidId } from './paths.ts';
import type { PromptRef } from './types.ts';

const PENDING_DIR = '.pending';
const TTL_MS = 60 * 60 * 1000;

export interface PendingRestore {
  ref: PromptRef;
  /** The folder whose window should restore it. */
  worktreePath: string;
  /** The checkout a repo-store prompt lives in. */
  sourceRepoRoot?: string;
  createdAt: string;
}

const canonicalPath = (path: string) => realpath(path).catch(() => resolve(path));

const markerPath = async (home: string, worktreePath: string) =>
  join(home, PENDING_DIR, `${createHash('sha256').update(await canonicalPath(worktreePath)).digest('hex').slice(0, 32)}.json`);

/** Records that the window opening on `worktreePath` should restore a prompt. */
export async function writePendingRestore(home: string, pending: Omit<PendingRestore, 'createdAt'>, now: Date = new Date()): Promise<void> {
  await mkdir(join(home, PENDING_DIR), { recursive: true, mode: 0o700 });
  const worktreePath = await canonicalPath(pending.worktreePath);
  const marker: PendingRestore = { ...pending, worktreePath, createdAt: now.toISOString() };
  await atomicWriteFile(await markerPath(home, worktreePath), `${JSON.stringify(marker, null, 2)}\n`);
}

/**
 * Takes the marker for a folder, if there is one. Windows take turns under a lock, so
 * only the first finds it, and it is gone before anything acts on it: a prompt is
 * restored at most once. A rename cannot do this, because concurrent renames of one
 * file can both succeed on Windows. An old or malformed marker is thrown away.
 */
export async function consumePendingRestore(home: string, worktreePath: string, now: Date = new Date()): Promise<PendingRestore | undefined> {
  const marker = await markerPath(home, worktreePath);
  if (!(await pathExists(marker))) return undefined;
  let pending: PendingRestore;
  try {
    const text = await withLock(`${marker}.lock`, async () => {
      const contents = await readFile(marker, 'utf8');
      await unlink(marker);
      return contents;
    });
    pending = JSON.parse(text) as PendingRestore;
  } catch {
    return undefined;
  }
  const age = now.getTime() - Date.parse(pending?.createdAt);
  const validRef = (pending?.ref?.store === 'global' || pending?.ref?.store === 'repo') && isValidId(String(pending?.ref?.id));
  if (!validRef || !(age >= 0 && age < TTL_MS) || pending.worktreePath !== (await canonicalPath(worktreePath))) return undefined;
  return pending;
}
