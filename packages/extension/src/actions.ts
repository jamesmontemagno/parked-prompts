import * as vscode from 'vscode';
import { basename, join, relative, sep } from 'node:path';
import {
  classifyFile,
  consumePendingRestore,
  contentHash,
  errorMessage,
  excerpt,
  missingReasonText,
  moveToRepo,
  planMoveToRepo,
  ParkedPromptsError,
  PromptCatalog,
  promptRevision,
  repoStoreRoot,
  resolveAttachments,
  writePendingRestore,
  type LineRange,
  type ParkedPrompt,
  type PromptRef,
  type PromptStatus,
} from '@parked-prompts/core';
import { detectSurface, restoreToChat, type ChatHost, type RestoreTarget } from './chatAdapter.ts';
import { chatInputCandidates, chooseChatInput, type ChatInputCandidate } from './chatInput.ts';
import type { ParkedService } from './service.ts';
import { confirmRepoPrompt, type PromptPreview } from './trustFlow.ts';
import { createWorktree, defaultWorktreePlan, runGit, validateBranchName, validateWorktreePath } from './worktree.ts';

export const chatHost: ChatHost = {
  executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
  getCommands: () => vscode.commands.getCommands(true),
  toUri: path => vscode.Uri.file(path),
};

const restoreTargetSetting = (): RestoreTarget =>
  vscode.workspace.getConfiguration('parkedPrompts').get<RestoreTarget>('restoreTarget') === 'currentChat' ? 'currentChat' : 'newChat';

const describe = (prompt: ParkedPrompt) => `"${prompt.title}"`;

export class PromptActions implements vscode.Disposable {
  readonly #service: ParkedService;
  readonly #preview: PromptPreview;
  readonly #disposables: vscode.Disposable[] = [];
  #lastEditedChatInput: string | undefined;

  constructor(service: ParkedService, preview: PromptPreview) {
    this.#service = service;
    this.#preview = preview;
    this.#disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (chatInputCandidates([event.document]).length > 0) this.#lastEditedChatInput = event.document.uri.toString();
      }),
    );
  }

  dispose(): void {
    for (const item of this.#disposables) item.dispose();
  }

  // --- Restore ---

  async restore(ref: PromptRef, target: RestoreTarget = restoreTargetSetting()): Promise<boolean> {
    const prompt = await this.#service.get(ref);
    if (!(await confirmRepoPrompt(this.#service, this.#preview, prompt))) return false;
    return this.#restorePrompt(prompt, target, await this.#service.attachments(prompt));
  }

  async copy(ref: PromptRef): Promise<boolean> {
    const prompt = await this.#service.get(ref);
    if (!(await confirmRepoPrompt(this.#service, this.#preview, prompt))) return false;
    await vscode.env.clipboard.writeText(prompt.body);
    return true;
  }

  async #restorePrompt(prompt: ParkedPrompt, target: RestoreTarget, attachments: Awaited<ReturnType<ParkedService['attachments']>>): Promise<boolean> {
    const surface = await detectSurface(chatHost);
    if (surface === 'editor' && target === 'currentChat' && !(await this.#confirmReplacingInput())) return false;
    const result = await restoreToChat(chatHost, { text: prompt.body, attachments, model: prompt.model }, target);

    const notes: string[] = [`Restored ${describe(prompt)}. It has not been sent.`];
    if (attachments.missing.length > 0) {
      notes.push(`Missing: ${attachments.missing.map(item => `${item.name} (${missingReasonText(item.reason)})`).join('; ')}.`);
    }
    if (!result.attachedFiles) notes.push('This window cannot attach files for an extension, so they are listed by path in the text.');
    if (result.droppedModel) notes.push('The saved model is not available here, so the current one is used.');

    const done = 'Mark as Done';
    const show = attachments.missing.length > 0 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void Promise.resolve(show(notes.join(' '), done)).then(async answer => {
      if (answer === done) await this.setStatus({ store: prompt.store, id: prompt.id }, 'done');
    });
    return true;
  }

  /** `chat.open` replaces the text in the input, so say so first. Attachments already there are kept by VS Code. */
  async #confirmReplacingInput(): Promise<boolean> {
    const existing = chatInputCandidates(vscode.workspace.textDocuments);
    if (existing.length === 0) return true;
    const replace = 'Replace';
    const answer = await vscode.window.showWarningMessage('Replace the text in the chat input?', { modal: true, detail: `It currently says: ${excerpt(existing[0]?.text ?? '', 200)}` }, replace);
    return answer === replace;
  }

  // --- Capture ---

  async parkTyped(): Promise<ParkedPrompt | undefined> {
    const candidates = chatInputCandidates(vscode.workspace.textDocuments);
    const choice = chooseChatInput(candidates, this.#lastEditedChatInput);
    let candidate: ChatInputCandidate | undefined;
    if (choice.kind === 'none') {
      void vscode.window.showInformationMessage('There is no text in the chat input to park. Type a prompt first, or use Park a New Prompt to add files and images.');
      return undefined;
    }
    if (choice.kind === 'one') candidate = choice.candidate;
    else {
      const picked = await vscode.window.showQuickPick(
        choice.candidates.map(item => ({ label: excerpt(item.text, 80), candidate: item })),
        { title: 'Which chat input should be parked?' },
      );
      candidate = picked?.candidate;
    }
    if (!candidate) return undefined;
    const prompt = await this.#service.catalog.global.create({ body: candidate.text, ...this.#repoField() });
    // Extensions cannot read chat attachments, so never let this look like it saved them.
    void vscode.window.showInformationMessage(`Parked ${describe(prompt)} from the chat input. Only the text was saved: VS Code does not let extensions read chat attachments, so add those again in the Parked Prompts view.`);
    this.#service.fire();
    return prompt;
  }

  #repoField() {
    const repo = this.#service.newPromptRepo();
    return repo ? { repo } : {};
  }

  /** Attaches a file to a prompt: a workspace reference when it can be, otherwise a copy. */
  async attachFile(prompt: ParkedPrompt, path: string, range?: LineRange): Promise<ParkedPrompt> {
    const store = this.#service.catalog.storeFor(prompt.store);
    const kept = classifyFile(path, this.#service.repo?.root);
    return kept.kind === 'workspace' ? store.addWorkspaceFile(prompt.id, kept.path, range) : store.addFile(prompt.id, path);
  }

  async #parkWithFile(file: vscode.Uri, range: LineRange | undefined, title: string): Promise<ParkedPrompt | undefined> {
    const body = await vscode.window.showInputBox({ title: `Park: ${title}`, prompt: 'What should the prompt say? You can leave this empty and edit it later.', placeHolder: 'Prompt text' });
    if (body === undefined) return undefined;
    const prompt = await this.#service.catalog.global.create({ title: body.trim() ? '' : title, body, ...this.#repoField() });
    const updated = await this.attachFile(prompt, file.fsPath, range);
    this.#service.fire();
    void vscode.window.showInformationMessage(`Parked ${describe(updated)}.`);
    return updated;
  }

  async parkSelection(): Promise<ParkedPrompt | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== 'file') {
      void vscode.window.showInformationMessage('Select some text in a saved file first.');
      return undefined;
    }
    const { start, end } = editor.selection;
    const range = { startLine: start.line + 1, endLine: end.character === 0 && end.line > start.line ? end.line : end.line + 1 };
    return this.#parkWithFile(editor.document.uri, range, `${basename(editor.document.uri.fsPath)}:${range.startLine}-${range.endLine}`);
  }

  async parkFile(resource?: vscode.Uri): Promise<ParkedPrompt | undefined> {
    const file = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!file || file.scheme !== 'file') {
      void vscode.window.showInformationMessage('Open a saved file first.');
      return undefined;
    }
    return this.#parkWithFile(file, undefined, basename(file.fsPath));
  }

  /** The Agents window has no views, so there a new prompt is written in an input box. */
  async parkFromInput(): Promise<ParkedPrompt | undefined> {
    const body = await vscode.window.showInputBox({ title: 'Park a New Prompt', prompt: 'It is saved for later, not sent.', placeHolder: 'Prompt text' });
    if (!body?.trim()) return undefined;
    let prompt = await this.#service.catalog.global.create({ body, ...this.#repoField() });
    const attach = 'Attach Files';
    const answer = await vscode.window.showInformationMessage(`Parked ${describe(prompt)}.`, attach);
    if (answer === attach) {
      for (const file of (await vscode.window.showOpenDialog({ canSelectMany: true, title: 'Attach to parked prompt' })) ?? []) {
        prompt = await this.attachFile(prompt, file.fsPath);
      }
    }
    this.#service.fire();
    return prompt;
  }

  // --- Choosing ---

  async pick(title: string, accept: (prompt: ParkedPrompt) => boolean = () => true): Promise<PromptRef | undefined> {
    const { prompts } = await this.#service.list();
    const items = prompts.filter(accept).map(prompt => ({
      label: prompt.title,
      description: [prompt.status === 'parked' ? '' : prompt.status, prompt.store === 'repo' ? 'from repo' : '', this.#service.repoLabelOf(prompt), prompt.attachments.length ? `${prompt.attachments.length} attached` : ''].filter(Boolean).join(' · '),
      detail: excerpt(prompt.body, 120),
      ref: { store: prompt.store, id: prompt.id },
    }));
    if (items.length === 0) {
      void vscode.window.showInformationMessage('No parked prompts here. Use Park a New Prompt to add one.');
      return undefined;
    }
    return (await vscode.window.showQuickPick(items, { title, matchOnDescription: true, matchOnDetail: true }))?.ref;
  }

  // --- Status ---

  async setStatus(ref: PromptRef, status: PromptStatus): Promise<void> {
    await this.#service.catalog.storeFor(ref.store).update(ref.id, { status });
    this.#service.fire();
  }

  async delete(ref: PromptRef): Promise<boolean> {
    const prompt = await this.#service.get(ref);
    const remove = 'Delete';
    const detail = prompt.store === 'repo' ? 'This removes it from your working copy. Git still has any committed version.' : 'This cannot be undone.';
    const answer = await vscode.window.showWarningMessage(`Delete ${describe(prompt)} and its attachments?`, { modal: true, detail }, remove);
    if (answer !== remove) return false;
    await this.#service.catalog.storeFor(ref.store).delete(ref.id);
    this.#service.fire();
    return true;
  }

  /**
   * Deletes the completed prompts the user could see, after one confirmation. Each is fingerprinted
   * before asking, so a prompt reopened or edited while the dialog was open is kept.
   */
  async clearDone(refs: PromptRef[]): Promise<{ cleared: number; changed: number; failed: number } | undefined> {
    const planned: { ref: PromptRef; revision: string }[] = [];
    let changed = 0;
    for (const ref of refs) {
      try {
        const prompt = await this.#service.get(ref);
        if (prompt.status === 'done') planned.push({ ref, revision: await promptRevision(prompt) });
        else changed += 1;
      } catch (error) {
        if (error instanceof ParkedPromptsError && error.code === 'not_found') changed += 1;
        else throw error;
      }
    }
    if (planned.length === 0) {
      void vscode.window.showInformationMessage('There are no completed prompts to clear.');
      this.#service.fire();
      return undefined;
    }
    const count = planned.length === 1 ? '1 completed prompt' : `${planned.length} completed prompts`;
    const repoCount = planned.filter(item => item.ref.store === 'repo').length;
    const detail = [
      'This cannot be undone. Referenced workspace files are kept.',
      repoCount > 0 && `${repoCount === 1 ? '1 prompt is' : `${repoCount} prompts are`} stored in this repository; their files will be removed from your working copy. Git still has any committed version.`,
    ].filter(Boolean).join('\n\n');
    const remove = 'Delete';
    const answer = await vscode.window.showWarningMessage(`Delete ${count} and their copied attachments?`, { modal: true, detail }, remove);
    if (answer !== remove) return undefined;
    let cleared = 0;
    const failures: string[] = [];
    for (const { ref, revision } of planned) {
      try {
        if (await this.#service.catalog.storeFor(ref.store).deleteDoneIfUnchanged(ref.id, revision)) cleared += 1;
        else changed += 1;
      } catch (error) {
        if (error instanceof ParkedPromptsError && error.code === 'not_found') changed += 1;
        else failures.push(errorMessage(error));
      }
    }
    this.#service.fire();
    if (failures.length > 0) {
      void vscode.window.showErrorMessage(`Cleared ${cleared}. ${failures.length} could not be deleted: ${failures.join('; ')}`);
    } else if (changed > 0) {
      void vscode.window.showInformationMessage(`Cleared ${cleared}. ${changed === 1 ? '1 prompt was' : `${changed} prompts were`} kept because ${changed === 1 ? 'it' : 'they'} changed.`);
    }
    return { cleared, changed, failed: failures.length };
  }

  // --- Worktree ---

  async runInWorktree(ref: PromptRef): Promise<void> {
    const repo = this.#service.repo;
    if (!repo || !this.#service.isGitRepo) {
      void vscode.window.showErrorMessage('Open a Git repository to run a prompt in a worktree.');
      return;
    }
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showErrorMessage('Trust this workspace to create a worktree, because that runs Git in it.');
      return;
    }
    const prompt = await this.#service.get(ref);
    if (!(await confirmRepoPrompt(this.#service, this.#preview, prompt))) return;

    const plan = defaultWorktreePlan(prompt.title, prompt.id, repo.root);
    const branch = await vscode.window.showInputBox({
      title: 'Run in a Worktree: Branch',
      prompt: 'The branch for the worktree. An existing branch is checked out; a new one starts from your current commit.',
      value: plan.branch,
      validateInput: value => validateBranchName(runGit, repo.root, value),
    });
    if (branch === undefined) return;
    const path = await vscode.window.showInputBox({
      title: 'Run in a Worktree: Folder',
      prompt: 'Where to create it. Worktrees are never deleted for you.',
      value: plan.path,
      validateInput: validateWorktreePath,
    });
    if (path === undefined) return;

    const create = 'Create and Open';
    const answer = await vscode.window.showInformationMessage(`Create a worktree for ${describe(prompt)}?`, { modal: true, detail: `Branch: ${branch.trim()}\nFolder: ${path.trim()}\n\nA new window opens with the prompt in a new chat, not sent. Your current checkout is not touched.` }, create);
    if (answer !== create) return;

    const created = await createWorktree(runGit, repo.root, { branch: branch.trim(), path: path.trim() });
    await writePendingRestore(this.#service.home, { ref, worktreePath: created, ...(prompt.store === 'repo' && { sourceRepoRoot: repo.root }) });
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(created), { forceNewWindow: true });
  }

  /** Called when a window starts: if another window opened this folder for a prompt, restore it, once. */
  async restorePending(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      const pending = await consumePendingRestore(this.#service.home, folder.uri.fsPath);
      if (!pending) continue;
      try {
        const catalog = pending.sourceRepoRoot ? new PromptCatalog({ home: this.#service.home, repo: { root: pending.sourceRepoRoot, isWorktree: false, label: basename(pending.sourceRepoRoot) } }) : this.#service.catalog;
        const prompt = await catalog.get(pending.ref);
        if (await catalog.trust.needsConfirmation(prompt)) {
          void vscode.window.showWarningMessage(`${describe(prompt)} changed in the repository after you accepted it, so it was not restored.`);
          return;
        }
        // Workspace references attach this worktree's copy of each file.
        const attachments = await resolveAttachments(prompt, folder.uri.fsPath);
        await this.#restorePrompt(prompt, 'newChat', attachments);
      } catch (error) {
        void vscode.window.showErrorMessage(`Could not restore the parked prompt: ${errorMessage(error)}`);
      }
      return;
    }
  }

  // --- Move to the repository ---

  async moveToRepo(ref: PromptRef): Promise<boolean> {
    const repo = this.#service.repo;
    const store = this.#service.catalog.repoStore;
    if (!repo || !store || !this.#service.isGitRepo) {
      void vscode.window.showErrorMessage('Open a trusted Git repository to move a prompt into it.');
      return false;
    }
    const prompt = await this.#service.get(ref);
    const plan = await planMoveToRepo(prompt, repo.root);
    const detail = [
      'These files will be added to the repository. They are not committed for you.',
      ...plan.files.map(file => `  ${file.path}`),
      ...(plan.references.length > 0 ? ['', 'Stays a reference, not copied:', ...plan.references.map(item => `  ${item}`)] : []),
      ...(plan.warnings.length > 0 ? ['', 'Check first:', ...plan.warnings.map(item => `  ${item}`)] : []),
      ...(plan.blockers.length > 0 ? ['', 'Cannot move:', ...plan.blockers.map(item => `  ${item}`)] : []),
    ].join('\n');
    if (plan.blockers.length > 0) {
      await vscode.window.showErrorMessage(`${describe(prompt)} cannot be moved yet.`, { modal: true, detail });
      return false;
    }
    const confirm = plan.warnings.length > 0 ? 'Move Anyway' : 'Move to Repository';
    const answer = await vscode.window.showWarningMessage(`Move ${describe(prompt)} into this repository?`, { modal: true, detail }, confirm);
    if (answer !== confirm) return false;
    const moved = await moveToRepo(this.#service.catalog.global, store, prompt.id, repo.root, plan.hash);
    // The user just reviewed this, so it does not need confirming again. Hashed again
    // because in the repo store the hash also covers the files it refers to.
    await this.#service.catalog.trust.confirm(await contentHash(moved), prompt.id);
    this.#service.fire();
    const open = 'Open Prompt File';
    const shown = relative(repo.root, repoStoreRoot(repo.root)).split(sep).join('/');
    const reply = await vscode.window.showInformationMessage(`Moved ${describe(moved)} to ${shown}. Review it and commit when you are ready.`, open);
    if (reply === open) await vscode.window.showTextDocument(vscode.Uri.file(join(moved.dir, 'prompt.md')));
    return true;
  }

  async openStore(): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.file(this.#service.home));
  }

  /** Reveals a file the prompt refers to. */
  async openAttachment(prompt: ParkedPrompt, path: string): Promise<void> {
    const { resolved } = await this.#service.attachments(prompt);
    const item = resolved.find(entry => entry.attachment.path === path);
    if (item) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.absolutePath));
  }
}
