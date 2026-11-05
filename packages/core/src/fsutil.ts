import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ParkedPromptsError, isNodeError } from './errors.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const pathExists = (path: string): Promise<boolean> =>
  lstat(path).then(() => true, () => false);

/** Windows can briefly refuse a rename while another process has the file open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= 8 || !isNodeError(error, 'EPERM', 'EACCES', 'EBUSY')) throw error;
      await sleep(25 * 2 ** attempt);
    }
  }
}

export { renameWithRetry as rename };

const tempPathFor = (path: string) => join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);

async function syncDirectory(path: string): Promise<void> {
  // Directories cannot be opened for syncing on Windows, and the rename is already durable enough there.
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r').catch(() => undefined);
  await handle?.sync().catch(() => undefined);
  await handle?.close().catch(() => undefined);
}

/** Readers see the old file or the new one, never a partial write. */
export async function atomicWriteFile(path: string, data: string | Uint8Array, mode = 0o600): Promise<void> {
  const temp = tempPathFor(path);
  try {
    const handle = await open(temp, 'wx', mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temp, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export interface CopiedFile {
  size: number;
  sha256: string;
}

/** Copies a file into place atomically, hashing it and stopping as soon as it passes the limit. */
export async function copyFileWithHash(source: string, destination: string, maxBytes: number, mode = 0o600): Promise<CopiedFile> {
  const info = await stat(source);
  if (!info.isFile()) throw new ParkedPromptsError('invalid_input', `"${basename(source)}" is not a file.`);
  if (info.size > maxBytes) throw tooLarge(basename(source), maxBytes);
  const temp = tempPathFor(destination);
  const hash = createHash('sha256');
  let size = 0;
  try {
    const out = await open(temp, 'wx', mode);
    try {
      for await (const chunk of createReadStream(source)) {
        const bytes = chunk as Buffer;
        size += bytes.length;
        if (size > maxBytes) throw tooLarge(basename(source), maxBytes);
        hash.update(bytes);
        await out.write(bytes);
      }
      await out.sync();
    } finally {
      await out.close();
    }
    await renameWithRetry(temp, destination);
    return { size, sha256: hash.digest('hex') };
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export const tooLarge = (name: string, maxBytes: number): ParkedPromptsError =>
  new ParkedPromptsError('too_large', `"${name}" is larger than the ${formatBytes(maxBytes)} limit.`);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface LockOptions {
  /** A lock older than this was left behind by a process that died. */
  staleMs?: number;
  timeoutMs?: number;
}

/**
 * Runs `task` holding a lock file, so the extension and the canvas cannot lose each
 * other's changes to the same entry.
 */
export async function withLock<T>(lockPath: string, task: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const { staleMs = 15_000, timeoutMs = 5_000 } = options;
  const started = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });
  for (let delay = 10; ; delay = Math.min(delay * 2, 200)) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.close();
      break;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST', 'EPERM', 'EACCES')) throw error;
      const held = await stat(lockPath).catch(() => undefined);
      if (held && Date.now() - held.mtimeMs > staleMs) await rm(lockPath, { force: true }).catch(() => undefined);
      if (Date.now() - started > timeoutMs) {
        throw new ParkedPromptsError('locked', 'This prompt is being changed somewhere else. Try again in a moment.');
      }
      await sleep(delay);
    }
  }
  try {
    return await task();
  } finally {
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}
