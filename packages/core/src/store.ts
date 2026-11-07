import { randomBytes, createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isImageFile, mimeFromName } from './attachments.ts';
import { ParkedPromptsError, errorMessage, isNodeError } from './errors.ts';
import { parsePrompt, serializePrompt } from './frontmatter.ts';
import { atomicWriteFile, copyFileWithHash, formatBytes, pathExists, rename, sha256File, tooLarge, withLock } from './fsutil.ts';
import { assertValidId, isValidId, newPromptId, normalizeRelativePath, realpathInside, resolveInside, safeFileName, uniqueName } from './paths.ts';
import { deriveTitle } from './text.ts';
import { contentHash } from './trust.ts';
import {
  DEFAULT_LIMITS,
  type Attachment,
  type CopiedAttachment,
  type LineRange,
  type ParkedPrompt,
  type PromptMeta,
  type PromptRepo,
  type PromptStatus,
  type StoreKind,
  type StoreLimits,
  type StoreProblem,
} from './types.ts';

export const PROMPT_FILE = 'prompt.md';
export const ATTACHMENTS_DIR = 'attachments';
const LOCK_FILE = '.lock';
const STALE_TEMP_MS = 60 * 60 * 1000;

export interface NewPrompt {
  title?: string;
  body?: string;
  status?: PromptStatus;
  repo?: PromptRepo;
  mode?: string;
  model?: string;
}

export interface PromptPatch {
  /** An empty title goes back to deriving one from the text. */
  title?: string;
  body?: string;
  status?: PromptStatus;
  repo?: PromptRepo;
  /** An empty value clears it. */
  mode?: string;
  model?: string;
}

export interface StoreOptions {
  limits?: Partial<StoreLimits>;
  now?: () => Date;
  /** Files in a global store are private to the user; a repo store is committed, so it keeps normal permissions. */
  fileMode?: number;
  directoryMode?: number;
}

/** A revision of the prompt file and copied attachment bytes, not workspace references. */
export async function promptRevision(prompt: ParkedPrompt): Promise<string> {
  const copies = prompt.attachments.filter(attachment => attachment.kind === 'copy');
  const content = await contentHash({ ...prompt, attachments: copies });
  const file = await realpathInside(prompt.dir, resolveInside(prompt.dir, PROMPT_FILE));
  return createHash('sha256').update(await sha256File(file)).update('\0').update(content).digest('hex');
}

/** One folder of entries: `<root>/<id>/prompt.md` plus `<root>/<id>/attachments/`. */
export class PromptStore {
  readonly root: string;
  readonly kind: StoreKind;
  readonly limits: StoreLimits;
  readonly #now: () => Date;
  readonly #fileMode: number;
  readonly #directoryMode: number;

  constructor(root: string, kind: StoreKind, options: StoreOptions = {}) {
    this.root = root;
    this.kind = kind;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.#now = options.now ?? (() => new Date());
    this.#fileMode = options.fileMode ?? (kind === 'global' ? 0o600 : 0o644);
    this.#directoryMode = options.directoryMode ?? (kind === 'global' ? 0o700 : 0o755);
  }

  #dir(id: string): string {
    assertValidId(id);
    return join(this.root, id);
  }

  /**
   * A repository controls its own `.github` folder, so a committed symlink there could
   * point the repo store anywhere on disk. It is refused for every read and write. The
   * global store is the user's own, and may reasonably be a link to synced dotfiles.
   */
  async assertSafeRoot(): Promise<void> {
    if (this.kind !== 'repo') return;
    for (const path of [dirname(this.root), this.root]) {
      const info = await lstat(path).catch(() => undefined);
      if (info?.isSymbolicLink()) throw new ParkedPromptsError('path_escape', `${basename(path)} is a symbolic link, so prompts in this repository were not used.`);
    }
  }

  async #readEntry(id: string): Promise<ParkedPrompt> {
    await this.assertSafeRoot();
    const dir = this.#dir(id);
    const folder = await lstat(dir).catch(() => undefined);
    if (!folder) throw new ParkedPromptsError('not_found', `There is no parked prompt with the ID ${id}.`);
    if (!folder.isDirectory()) throw new ParkedPromptsError('corrupt_entry', 'The entry is not a real folder.');
    const file = join(dir, PROMPT_FILE);
    const info = await lstat(file).catch(() => undefined);
    if (!info) throw new ParkedPromptsError('corrupt_entry', `The entry has no ${PROMPT_FILE}.`);
    if (!info.isFile()) throw new ParkedPromptsError('corrupt_entry', `${PROMPT_FILE} is not a regular file.`);
    if (info.size > this.limits.maxPromptBytes) {
      throw new ParkedPromptsError('corrupt_entry', `${PROMPT_FILE} is larger than the ${formatBytes(this.limits.maxPromptBytes)} limit.`);
    }
    const { meta, body, warnings } = parsePrompt(await readFile(file, 'utf8'), id, info.mtime.toISOString());
    return { ...meta, store: this.kind, dir, body, warnings };
  }

  async get(id: string): Promise<ParkedPrompt> {
    return this.#readEntry(id);
  }

  /** Reads every entry, newest first. A bad entry is reported, never fatal, and never stops the others. */
  async list(): Promise<{ prompts: ParkedPrompt[]; problems: StoreProblem[] }> {
    const prompts: ParkedPrompt[] = [];
    const problems: StoreProblem[] = [];
    try {
      await this.assertSafeRoot();
    } catch (error) {
      return { prompts, problems: [{ store: this.kind, id: basename(this.root), dir: this.root, reason: errorMessage(error) }] };
    }
    const names = await readdir(this.root).catch(error => {
      if (isNodeError(error, 'ENOENT', 'ENOTDIR')) return [] as string[];
      throw error;
    });
    await Promise.all(
      names.map(async name => {
        if (name.startsWith('.')) return;
        const dir = join(this.root, name);
        if (!isValidId(name)) {
          const info = await lstat(dir).catch(() => undefined);
          if (info?.isDirectory()) problems.push({ store: this.kind, id: name, dir, reason: 'The folder name is not a valid prompt ID.' });
          return;
        }
        try {
          prompts.push(await this.#readEntry(name));
        } catch (error) {
          problems.push({ store: this.kind, id: name, dir, reason: errorMessage(error) });
        }
      }),
    );
    prompts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return { prompts, problems: problems.sort((a, b) => a.id.localeCompare(b.id)) };
  }

  async #ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: this.#directoryMode });
  }

  #assertBodySize(body: string): void {
    if (Buffer.byteLength(body) > this.limits.maxPromptBytes - 8192) {
      throw new ParkedPromptsError('too_large', `The prompt text is larger than the ${formatBytes(this.limits.maxPromptBytes)} limit.`);
    }
  }

  /** The entry appears all at once: it is built in a hidden folder and then renamed into place. */
  async create(input: NewPrompt = {}, id: string = newPromptId(this.#now())): Promise<ParkedPrompt> {
    const dir = this.#dir(id);
    const body = input.body ?? '';
    this.#assertBodySize(body);
    await this.assertSafeRoot();
    await this.#ensureRoot();
    const temp = join(this.root, `.tmp-${id}-${randomBytes(3).toString('hex')}`);
    const time = this.#now().toISOString();
    const meta: PromptMeta = {
      id,
      title: input.title?.trim() || deriveTitle(body),
      createdAt: time,
      updatedAt: time,
      status: input.status ?? 'parked',
      ...(input.repo && { repo: input.repo }),
      ...(input.mode && { mode: input.mode }),
      ...(input.model && { model: input.model }),
      attachments: [],
    };
    try {
      await mkdir(join(temp, ATTACHMENTS_DIR), { recursive: true, mode: this.#directoryMode });
      await writeFile(join(temp, PROMPT_FILE), serializePrompt(meta, body), { mode: this.#fileMode });
      if (await pathExists(dir)) throw new ParkedPromptsError('already_exists', `A parked prompt with the ID ${id} already exists.`);
      await rename(temp, dir);
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { ...meta, store: this.kind, dir, body, warnings: [] };
  }

  /** Reads, changes, and writes an entry under its lock, and only moves `updatedAt` on a real change. */
  async #change(id: string, apply: (prompt: ParkedPrompt) => Promise<PromptMeta | undefined> | PromptMeta | undefined, nextBody?: string): Promise<ParkedPrompt> {
    const dir = this.#dir(id);
    await this.#readEntry(id);
    return this.withEntryLock(id, async () => {
      const current = await this.#readEntry(id);
      const meta = await apply(current);
      if (!meta) return current;
      const body = nextBody ?? current.body;
      const updated: PromptMeta = { ...meta, updatedAt: this.#now().toISOString() };
      await atomicWriteFile(join(dir, PROMPT_FILE), serializePrompt(updated, body), this.#fileMode);
      return { ...updated, store: this.kind, dir, body, warnings: current.warnings };
    });
  }

  async update(id: string, patch: PromptPatch): Promise<ParkedPrompt> {
    if (patch.body !== undefined) this.#assertBodySize(patch.body);
    return this.#change(
      id,
      current => {
        const body = patch.body ?? current.body;
        const next: PromptMeta = {
          id: current.id,
          title: patch.title !== undefined ? patch.title.trim() || deriveTitle(body) : current.title,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
          status: patch.status ?? current.status,
          attachments: current.attachments,
        };
        const repo = patch.repo ?? current.repo;
        const mode = patch.mode !== undefined ? patch.mode : current.mode;
        const model = patch.model !== undefined ? patch.model : current.model;
        if (repo) next.repo = repo;
        if (mode) next.mode = mode;
        if (model) next.model = model;
        const unchanged = next.title === current.title && body === current.body && next.status === current.status && next.mode === current.mode && next.model === current.model && JSON.stringify(next.repo) === JSON.stringify(current.repo);
        return unchanged ? undefined : next;
      },
      patch.body,
    );
  }

  /** Holds an entry's lock, for changes that span more than one file. */
  withEntryLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    return withLock(join(this.#dir(id), LOCK_FILE), task, { createDirectory: false });
  }

  async delete(id: string): Promise<void> {
    await this.assertSafeRoot();
    const dir = this.#dir(id);
    const info = await lstat(dir).catch(() => undefined);
    if (!info) throw new ParkedPromptsError('not_found', `There is no parked prompt with the ID ${id}.`);
    // A bad entry may be a link, and a lock file must never be written through one.
    if (info.isDirectory()) await this.withEntryLock(id, () => this.deleteWhileLocked(id));
    else await rm(dir, { force: true });
  }

  /** Deletes only the completed revision the user chose, under the same lock as edits. */
  async deleteDoneIfUnchanged(id: string, revision: string): Promise<boolean> {
    await this.#readEntry(id);
    return this.withEntryLock(id, async () => {
      const current = await this.#readEntry(id);
      if (current.status !== 'done' || (await promptRevision(current)) !== revision) return false;
      await this.deleteWhileLocked(id);
      return true;
    });
  }

  /** Hides the entry first, so a reader never sees half of it. The caller holds its lock. */
  async deleteWhileLocked(id: string): Promise<void> {
    const trash = join(this.root, `.trash-${id}-${randomBytes(3).toString('hex')}`);
    await rename(this.#dir(id), trash);
    await rm(trash, { recursive: true, force: true });
  }

  #assertCapacity(prompt: ParkedPrompt, incomingBytes: number, name: string): void {
    if (prompt.attachments.length >= this.limits.maxAttachments) {
      throw new ParkedPromptsError('too_many', `A prompt can have at most ${this.limits.maxAttachments} attachments.`);
    }
    if (incomingBytes > this.limits.maxAttachmentBytes) throw tooLarge(name, this.limits.maxAttachmentBytes);
    const used = prompt.attachments.reduce((total, item) => total + (item.kind === 'copy' ? item.size : 0), 0);
    if (used + incomingBytes > this.limits.maxTotalBytes) {
      throw new ParkedPromptsError('too_large', `This prompt's attachments would pass the ${formatBytes(this.limits.maxTotalBytes)} limit.`);
    }
  }

  async #storedName(prompt: ParkedPrompt, wanted: string): Promise<string> {
    const folder = join(prompt.dir, ATTACHMENTS_DIR);
    await mkdir(folder, { recursive: true, mode: this.#directoryMode });
    const existing = await readdir(folder).catch(() => [] as string[]);
    return uniqueName(safeFileName(wanted), new Set(existing));
  }

  /** Copies a file into the entry. */
  async addFile(id: string, sourcePath: string, options: { name?: string; mime?: string } = {}): Promise<ParkedPrompt> {
    const name = options.name ?? basename(sourcePath);
    const info = await stat(sourcePath).catch(() => undefined);
    if (!info?.isFile()) throw new ParkedPromptsError('not_found', `"${name}" is not a file that can be attached.`);
    return this.#change(id, async current => {
      this.#assertCapacity(current, info.size, name);
      const stored = await this.#storedName(current, name);
      const { size, sha256 } = await copyFileWithHash(sourcePath, join(current.dir, ATTACHMENTS_DIR, stored), this.limits.maxAttachmentBytes, this.#fileMode);
      const attachment: CopiedAttachment = { kind: 'copy', path: `${ATTACHMENTS_DIR}/${stored}`, name, mime: options.mime ?? mimeFromName(stored), size, sha256 };
      return { ...current, attachments: [...current.attachments, attachment] };
    });
  }

  /** Stores bytes from a paste or an upload. */
  async addBytes(id: string, data: Uint8Array, options: { name: string; mime?: string }): Promise<ParkedPrompt> {
    return this.#change(id, async current => {
      this.#assertCapacity(current, data.byteLength, options.name);
      const stored = await this.#storedName(current, options.name);
      await atomicWriteFile(join(current.dir, ATTACHMENTS_DIR, stored), data, this.#fileMode);
      const attachment: CopiedAttachment = {
        kind: 'copy',
        path: `${ATTACHMENTS_DIR}/${stored}`,
        name: options.name,
        mime: options.mime ?? mimeFromName(stored),
        size: data.byteLength,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
      return { ...current, attachments: [...current.attachments, attachment] };
    });
  }

  /** Adds a reference to a workspace file. The path is checked, not the file: it may be missing today and back tomorrow. */
  async addWorkspaceFile(id: string, relativePath: string, range?: LineRange): Promise<ParkedPrompt> {
    const path = normalizeRelativePath(relativePath);
    if (range && (range.startLine < 1 || range.endLine < range.startLine)) {
      throw new ParkedPromptsError('invalid_input', 'The line range is not valid.');
    }
    return this.#change(id, current => {
      const same = (item: Attachment) => item.kind === 'workspace' && item.path === path && JSON.stringify(item.range) === JSON.stringify(range);
      if (current.attachments.some(same)) return undefined;
      this.#assertCapacity(current, 0, path);
      return { ...current, attachments: [...current.attachments, { kind: 'workspace', path, ...(range && { range }) }] };
    });
  }

  async removeAttachment(id: string, attachmentPath: string, range?: LineRange): Promise<ParkedPrompt> {
    return this.#change(id, async current => {
      const index = current.attachments.findIndex(item => item.path === attachmentPath && (item.kind !== 'workspace' || JSON.stringify(item.range) === JSON.stringify(range)));
      const target = current.attachments[index];
      if (!target) return undefined;
      if (target.kind === 'copy') await unlink(resolveInside(current.dir, target.path)).catch(() => undefined);
      return { ...current, attachments: current.attachments.filter((_, i) => i !== index) };
    });
  }

  /** Removes folders left behind by a process that died part way through a create or delete. */
  async sweep(): Promise<void> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    const now = this.#now().getTime();
    await Promise.all(
      names
        .filter(name => name.startsWith('.tmp-') || name.startsWith('.trash-'))
        .map(async name => {
          const path = join(this.root, name);
          const info = await lstat(path).catch(() => undefined);
          if (info && now - info.mtimeMs > STALE_TEMP_MS) await rm(path, { recursive: true, force: true }).catch(() => undefined);
        }),
    );
  }
}

/** True when an attachment should be treated as an image, by its stored file name. */
export const isImageAttachment = (attachment: Attachment): boolean => attachment.kind === 'copy' && isImageFile(attachment.path);
