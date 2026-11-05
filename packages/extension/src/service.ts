import * as vscode from 'vscode';
import {
  PromptCatalog,
  readRepoInfo,
  promptRepoFrom,
  workspaceRootFor,
  resolveAttachments,
  remoteLabel,
  defaultHome,
  type AttachmentResolution,
  type ParkedPrompt,
  type PromptRef,
  type PromptScope,
  type RepoInfo,
  type StoreProblem,
} from '@parked-prompts/core';
import { basename } from 'node:path';

/** The current catalog for this window, kept up to date as the workspace, its trust, and the store change. */
export class ParkedService implements vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#changed.event;
  readonly #disposables: vscode.Disposable[] = [this.#changed];
  #watchers: vscode.Disposable[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #catalog: PromptCatalog;
  #repo: RepoInfo | undefined;
  #isGitRepo = false;
  scope: PromptScope = 'repo';

  private constructor() {
    this.#catalog = new PromptCatalog({ home: defaultHome() });
    this.#disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.reload()),
    );
  }

  static async create(): Promise<ParkedService> {
    const service = new ParkedService();
    await service.reload();
    return service;
  }

  get catalog(): PromptCatalog {
    return this.#catalog;
  }

  get repo(): RepoInfo | undefined {
    return this.#repo;
  }

  /** True when the open folder is a Git repository, not just a folder. */
  get isGitRepo(): boolean {
    return this.#isGitRepo;
  }

  get home(): string {
    return this.#catalog.home;
  }

  async #findRepo(): Promise<void> {
    const active = vscode.window.activeTextEditor?.document.uri;
    const folder = (active && vscode.workspace.getWorkspaceFolder(active)) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== 'file') {
      this.#repo = undefined;
      this.#isGitRepo = false;
      return;
    }
    const repo = await readRepoInfo(folder.uri.fsPath);
    this.#isGitRepo = repo !== undefined;
    // A plain folder still scopes prompts, by path.
    this.#repo = repo ?? { root: folder.uri.fsPath, isWorktree: false, label: basename(folder.uri.fsPath) };
  }

  async reload(): Promise<void> {
    await this.#findRepo();
    this.#catalog = new PromptCatalog({
      home: defaultHome(),
      ...(this.#repo && { repo: this.#repo }),
      // Prompts that arrive by Git are not shown in a workspace nobody has trusted.
      allowRepoStore: vscode.workspace.isTrusted && this.#isGitRepo,
    });
    this.#watch();
    this.fire();
  }

  /** The store is also changed by the canvas and other windows, so changes on disk refresh the list. */
  #watch(): void {
    for (const watcher of this.#watchers) watcher.dispose();
    this.#watchers = [];
    const roots = [this.#catalog.global.root, this.#catalog.repoStore?.root].filter((root): root is string => Boolean(root));
    for (const root of roots) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*'));
      this.#watchers.push(watcher, watcher.onDidChange(() => this.fire()), watcher.onDidCreate(() => this.fire()), watcher.onDidDelete(() => this.fire()));
    }
  }

  /** Coalesces the bursts of events one change makes. */
  fire(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#changed.fire(), 75);
  }

  list(scope: PromptScope = this.scope): Promise<{ prompts: ParkedPrompt[]; problems: StoreProblem[] }> {
    return this.#catalog.list(scope);
  }

  get(ref: PromptRef): Promise<ParkedPrompt> {
    return this.#catalog.get(ref);
  }

  newPromptRepo() {
    return promptRepoFrom(this.#repo);
  }

  /** Workspace references resolve in the open checkout when it is the prompt's repository. */
  attachments(prompt: ParkedPrompt): Promise<AttachmentResolution> {
    return resolveAttachments(prompt, workspaceRootFor(prompt, this.#repo));
  }

  repoLabelOf(prompt: ParkedPrompt): string | undefined {
    if (prompt.repo?.remote) return remoteLabel(prompt.repo.remote);
    return prompt.repo?.path ? basename(prompt.repo.path) : undefined;
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    for (const item of [...this.#watchers, ...this.#disposables]) item.dispose();
  }
}
