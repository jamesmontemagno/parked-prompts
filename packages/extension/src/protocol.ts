import type { PromptScope, PromptStatus, StoreKind } from '@parked-prompts/core';

/** What the list shows about a prompt. */
export interface PromptView {
  id: string;
  store: StoreKind;
  title: string;
  excerpt: string;
  body: string;
  status: PromptStatus;
  updatedAt: string;
  repoLabel?: string;
  mode?: string;
  model?: string;
  /** From the repo store: treat as untrusted until the user confirms it. */
  needsConfirmation: boolean;
  /** True when it belongs to the open repository. */
  inCurrentRepo: boolean;
  attachments: AttachmentView[];
  warnings: string[];
}

export interface AttachmentView {
  /** The attachment's stored path, which identifies it. */
  path: string;
  label: string;
  kind: 'copy' | 'workspace';
  startLine?: number;
  endLine?: number;
  /** A webview URL for showing an image, when it is an image that can be shown. */
  imageUrl?: string;
  missing?: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ViewState {
  prompts: PromptView[];
  problems: { id: string; reason: string }[];
  scope: PromptScope;
  repoLabel?: string;
  /** False in an untrusted workspace. */
  trusted: boolean;
  isGitRepo: boolean;
  models: ModelOption[];
  restoreTarget: 'newChat' | 'currentChat';
}

export interface PromptRefMessage {
  id: string;
  store: StoreKind;
}

export type ToHost =
  | { type: 'ready' }
  | { type: 'setScope'; scope: PromptScope }
  | { type: 'saveDraft'; requestId: number; id?: string; title: string; body: string; mode: string; model: string }
  | { type: 'park'; id: string }
  | { type: 'discardDraft'; id: string }
  | { type: 'addImage'; requestId: number; id?: string; title: string; body: string; mode: string; model: string; mime: string; dataBase64: string; name?: string }
  | { type: 'pickFiles'; requestId: number; id?: string; title: string; body: string; mode: string; model: string }
  | { type: 'removeAttachment'; id: string; path: string; startLine?: number; endLine?: number }
  | { type: 'restore'; ref: PromptRefMessage; target?: 'newChat' | 'currentChat' }
  | { type: 'edit'; ref: PromptRefMessage }
  | { type: 'preview'; ref: PromptRefMessage }
  | { type: 'setStatus'; ref: PromptRefMessage; status: PromptStatus }
  | { type: 'delete'; ref: PromptRefMessage }
  | { type: 'worktree'; ref: PromptRefMessage }
  | { type: 'moveToRepo'; ref: PromptRefMessage }
  | { type: 'openFile'; ref: PromptRefMessage; path: string };

export type ToWebview =
  | { type: 'state'; state: ViewState }
  | { type: 'saved'; requestId: number; id: string; prompt?: PromptView }
  | { type: 'failed'; requestId: number; message: string }
  | { type: 'load'; prompt: PromptView }
  | { type: 'newPrompt' }
  | { type: 'notice'; message: string };
