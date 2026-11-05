import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { attachmentLabel, resolveAttachments } from './attachments.ts';
import { atomicWriteFile, sha256File } from './fsutil.ts';
import type { ParkedPrompt } from './types.ts';

const TRUST_FILE = '.trust.json';
const MAX_CONFIRMATIONS = 2000;

// Zero-width characters, bidirectional controls, and Unicode tag characters can hide
// instructions from a reader while the model still sees them.
const HIDDEN_CHARACTERS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\u{E0000}-\u{E007F}]/gu;

export const countHiddenCharacters = (text: string): number => text.match(HIDDEN_CHARACTERS)?.length ?? 0;

/** Shows hidden characters as visible markers such as `[U+200B]`, for previews. */
export const revealHiddenCharacters = (text: string): string =>
  text.replace(HIDDEN_CHARACTERS, char => `[U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}]`);

/**
 * A fingerprint of everything a prompt would deliver. Attached copies are hashed from
 * their bytes on disk, not from what the frontmatter claims.
 */
export async function contentHash(prompt: ParkedPrompt): Promise<string> {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ title: prompt.title, body: prompt.body, mode: prompt.mode ?? '', model: prompt.model ?? '' }));
  const { resolved, missing } = await resolveAttachments(prompt, undefined);
  for (const item of resolved) {
    hash.update(`\0${item.attachment.path}\0${await sha256File(item.absolutePath)}`);
  }
  for (const item of missing) {
    const { attachment } = item;
    hash.update(`\0${attachment.kind}\0${attachment.path}\0${attachment.kind === 'workspace' ? JSON.stringify(attachment.range ?? null) : item.reason}`);
  }
  return hash.digest('hex');
}

export interface UntrustedPreview {
  hash: string;
  /** The text with hidden characters made visible. */
  text: string;
  hiddenCharacters: number;
  attachments: string[];
  warnings: string[];
}

/** What to show someone before they accept a prompt that arrived by Git. */
export async function previewUntrusted(prompt: ParkedPrompt): Promise<UntrustedPreview> {
  const hiddenCharacters = countHiddenCharacters(prompt.body) + countHiddenCharacters(prompt.title);
  const warnings = [...prompt.warnings];
  if (hiddenCharacters > 0) {
    warnings.unshift(`This prompt contains ${hiddenCharacters} hidden character${hiddenCharacters === 1 ? '' : 's'}, which can conceal instructions. They are marked in the preview.`);
  }
  return {
    hash: await contentHash(prompt),
    text: revealHiddenCharacters(prompt.body),
    hiddenCharacters,
    attachments: prompt.attachments.map(attachmentLabel),
    warnings,
  };
}

interface TrustFile {
  confirmed: Record<string, { at: string; id: string }>;
}

/**
 * Remembers which exact versions of repo prompts the user has looked at and accepted,
 * in the home folder where a Git pull cannot write. Any change to the prompt changes
 * its hash, so it needs confirming again.
 */
export class TrustStore {
  readonly #file: string;
  readonly #home: string;

  constructor(home: string) {
    this.#home = home;
    this.#file = join(home, TRUST_FILE);
  }

  async #read(): Promise<TrustFile> {
    try {
      const parsed = JSON.parse(await readFile(this.#file, 'utf8')) as Partial<TrustFile>;
      return { confirmed: parsed.confirmed && typeof parsed.confirmed === 'object' ? parsed.confirmed : {} };
    } catch {
      return { confirmed: {} };
    }
  }

  async isConfirmed(hash: string): Promise<boolean> {
    const { confirmed } = await this.#read();
    return Object.hasOwn(confirmed, hash);
  }

  async needsConfirmation(prompt: ParkedPrompt): Promise<boolean> {
    return prompt.store === 'repo' && !(await this.isConfirmed(await contentHash(prompt)));
  }

  async confirm(hash: string, id: string, now: Date = new Date()): Promise<void> {
    const file = await this.#read();
    file.confirmed[hash] = { at: now.toISOString(), id };
    const entries = Object.entries(file.confirmed).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_CONFIRMATIONS);
    await mkdir(this.#home, { recursive: true, mode: 0o700 });
    await atomicWriteFile(this.#file, `${JSON.stringify({ confirmed: Object.fromEntries(entries) }, null, 2)}\n`);
  }
}
