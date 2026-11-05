export const SCHEMA_VERSION = 1;

export type PromptStatus = 'draft' | 'parked' | 'done';
export const PROMPT_STATUSES: readonly PromptStatus[] = ['draft', 'parked', 'done'];

/** `global` lives in the home folder; `repo` lives in the repository and may arrive by Git. */
export type StoreKind = 'global' | 'repo';

/** 1-based, inclusive. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/** A file copied into the entry, such as an image or a file outside the workspace. */
export interface CopiedAttachment {
  kind: 'copy';
  /** Entry-relative POSIX path, always directly under `attachments/`. */
  path: string;
  /** The name to show, which may differ from the stored file name. */
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

/** A reference to a workspace file, so restoring attaches its current version. */
export interface WorkspaceAttachment {
  kind: 'workspace';
  /** POSIX path relative to the repository root. */
  path: string;
  range?: LineRange;
}

export type Attachment = CopiedAttachment | WorkspaceAttachment;

export interface PromptRepo {
  /** Normalized Git remote, such as `github.com/owner/repo`. Never holds credentials. */
  remote?: string;
  /** Absolute path of the checkout it was parked from. Removed when moved to a repo store. */
  path?: string;
}

export interface PromptMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: PromptStatus;
  repo?: PromptRepo;
  mode?: string;
  model?: string;
  attachments: Attachment[];
}

export interface ParkedPrompt extends PromptMeta {
  store: StoreKind;
  /** Absolute path of the entry's folder. */
  dir: string;
  body: string;
  /** Non-fatal problems found while reading the entry, such as a dropped attachment. */
  warnings: string[];
}

export interface PromptRef {
  store: StoreKind;
  id: string;
}

/** An entry that could not be read. Listing reports it and carries on. */
export interface StoreProblem {
  store: StoreKind;
  id: string;
  dir: string;
  reason: string;
}

export interface StoreLimits {
  maxAttachmentBytes: number;
  maxTotalBytes: number;
  maxAttachments: number;
  maxPromptBytes: number;
}

export const DEFAULT_LIMITS: StoreLimits = {
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxAttachments: 50,
  maxPromptBytes: 2 * 1024 * 1024,
};
