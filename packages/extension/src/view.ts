import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { attachmentLabel, errorMessage, excerpt, isImageFile, matchRepo, ParkedPromptsError, pastedImageName, type ParkedPrompt, type PromptRef } from '@parked-prompts/core';
import type { PromptActions } from './actions.ts';
import type { AttachmentView, ModelOption, PromptView, ToHost, ToWebview, ViewState } from './protocol.ts';
import type { ParkedService } from './service.ts';
import type { PromptPreview } from './trustFlow.ts';

const MAX_IMAGE_BASE64 = Math.ceil((25 * 1024 * 1024 * 4) / 3) + 8;
const TIPS_SEEN_KEY = 'parkedPrompts.tipsSeen';
const ALLOWED_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

/** The composer and list. Its page has no access to anything except these messages. */
export class ParkedViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'parkedPrompts.view';
  readonly #extensionUri: vscode.Uri;
  readonly #service: ParkedService;
  readonly #actions: PromptActions;
  readonly #preview: PromptPreview;
  readonly #memento: vscode.Memento;
  readonly #disposables: vscode.Disposable[] = [];
  #view: vscode.WebviewView | undefined;
  #models: ModelOption[] = [];
  #pending: ToWebview[] = [];

  constructor(extensionUri: vscode.Uri, service: ParkedService, actions: PromptActions, preview: PromptPreview, memento: vscode.Memento) {
    this.#extensionUri = extensionUri;
    this.#memento = memento;
    this.#service = service;
    this.#actions = actions;
    this.#preview = preview;
    this.#disposables.push(
      service.onDidChange(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('parkedPrompts')) void this.refresh();
      }),
    );
    if (vscode.lm) this.#disposables.push(vscode.lm.onDidChangeChatModels(() => void this.#loadModels()));
    void this.#loadModels();
  }

  dispose(): void {
    for (const item of this.#disposables) item.dispose();
  }

  async #loadModels(): Promise<void> {
    try {
      const models = (await vscode.lm?.selectChatModels()) ?? [];
      this.#models = models.map(model => ({ id: model.id, label: model.name || model.id }));
    } catch {
      this.#models = [];
    }
    void this.refresh();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: this.#roots() };
    view.webview.html = this.#html(view.webview);
    this.#disposables.push(
      view.webview.onDidReceiveMessage((message: ToHost) => void this.#handle(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible) void this.refresh();
      }),
      view.onDidDispose(() => {
        this.#view = undefined;
      }),
    );
  }

  #roots(): vscode.Uri[] {
    const { catalog } = this.#service;
    return [
      vscode.Uri.joinPath(this.#extensionUri, 'dist'),
      vscode.Uri.joinPath(this.#extensionUri, 'media'),
      vscode.Uri.file(catalog.global.root),
      ...(catalog.repoStore ? [vscode.Uri.file(catalog.repoStore.root)] : []),
    ];
  }

  #html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, 'dist', name));
    // Prompt text may have come from a Git pull, so the page runs nothing but its own script.
    const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset('webview.css')}">
<title>Parked Prompts</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
  }

  #post(message: ToWebview): void {
    if (this.#view) void this.#view.webview.postMessage(message);
    else this.#pending.push(message);
  }

  /** Shows the view and starts a new prompt. */
  async focusComposer(): Promise<void> {
    await vscode.commands.executeCommand(`${ParkedViewProvider.viewId}.focus`);
    this.#post({ type: 'newPrompt' });
  }

  async #toView(prompt: ParkedPrompt, webview: vscode.Webview): Promise<PromptView> {
    const { resolved, missing } = await this.#service.attachments(prompt);
    const attachments: AttachmentView[] = prompt.attachments.map(attachment => {
      const found = resolved.find(item => item.attachment === attachment);
      const absent = missing.find(item => item.attachment === attachment);
      const range = attachment.kind === 'workspace' && attachment.range ? { startLine: attachment.range.startLine, endLine: attachment.range.endLine } : {};
      return {
        path: attachment.path,
        label: attachmentLabel(attachment),
        kind: attachment.kind,
        ...range,
        ...(found?.image && isImageFile(found.absolutePath) && attachment.kind === 'copy' && { imageUrl: webview.asWebviewUri(vscode.Uri.file(found.absolutePath)).toString() }),
        ...(absent && { missing: absent.reason }),
      };
    });
    const repoLabel = this.#service.repoLabelOf(prompt);
    return {
      id: prompt.id,
      store: prompt.store,
      title: prompt.title,
      excerpt: excerpt(prompt.body),
      body: prompt.body,
      status: prompt.status,
      updatedAt: prompt.updatedAt,
      ...(repoLabel && { repoLabel }),
      ...(prompt.model && { model: prompt.model }),
      needsConfirmation: await this.#service.catalog.trust.needsConfirmation(prompt),
      inCurrentRepo: prompt.store === 'repo' || matchRepo(prompt.repo, this.#service.repo) !== 'none',
      attachments,
      warnings: prompt.warnings,
    };
  }

  async refresh(): Promise<void> {
    const view = this.#view;
    if (!view) return;
    view.webview.options = { enableScripts: true, localResourceRoots: this.#roots() };
    const { prompts, problems } = await this.#service.list();
    const state: ViewState = {
      prompts: await Promise.all(prompts.map(prompt => this.#toView(prompt, view.webview))),
      problems: problems.map(problem => ({ id: problem.id, reason: problem.reason })),
      scope: this.#service.scope,
      ...(this.#service.repo && { repoLabel: this.#service.repo.label }),
      trusted: vscode.workspace.isTrusted,
      isGitRepo: this.#service.isGitRepo,
      models: this.#models,
      restoreTarget: vscode.workspace.getConfiguration('parkedPrompts').get('restoreTarget') === 'currentChat' ? 'currentChat' : 'newChat',
      showTips: !this.#memento.get<boolean>(TIPS_SEEN_KEY, false),
    };
    void view.webview.postMessage({ type: 'state', state } satisfies ToWebview);
  }

  async #saveComposer(message: { id?: string; title: string; body: string; model: string }): Promise<ParkedPrompt> {
    const store = this.#service.catalog.global;
    const fields = { title: message.title, body: message.body, model: message.model };
    if (message.id) return store.update(message.id, fields);
    const repo = this.#service.newPromptRepo();
    return store.create({ ...fields, status: 'draft', ...(repo && { repo }) });
  }

  /** A draft this request created goes away if the attach fails, or the next autosave would make a second one. */
  async #attachToComposer(message: { id?: string; title: string; body: string; model: string }, attach: (prompt: ParkedPrompt) => Promise<ParkedPrompt>): Promise<ParkedPrompt> {
    const prompt = await this.#saveComposer(message);
    try {
      return await attach(prompt);
    } catch (error) {
      if (!message.id) await this.#service.catalog.global.delete(prompt.id).catch(() => undefined);
      throw error;
    }
  }

  async #handle(message: ToHost): Promise<void> {
    try {
      await this.#dispatch(message);
    } catch (error) {
      const text = errorMessage(error);
      const code = error instanceof ParkedPromptsError ? error.code : undefined;
      if ('requestId' in message) this.#post({ type: 'failed', requestId: message.requestId, message: text, ...(code && { code }) });
      else void vscode.window.showErrorMessage(text);
    }
  }

  async #replyWith(requestId: number, prompt: ParkedPrompt): Promise<void> {
    const view = this.#view;
    this.#post({ type: 'saved', requestId, id: prompt.id, ...(view && { prompt: await this.#toView(prompt, view.webview) }) });
    this.#service.fire();
  }

  async #dispatch(message: ToHost): Promise<void> {
    const { catalog } = this.#service;
    const ref = (value: PromptRef) => ({ store: value.store === 'repo' ? ('repo' as const) : ('global' as const), id: String(value.id) });
    switch (message.type) {
      case 'ready':
        for (const queued of this.#pending.splice(0)) this.#post(queued);
        await this.refresh();
        return;
      case 'dismissTips':
        await this.#memento.update(TIPS_SEEN_KEY, true);
        await this.refresh();
        return;
      case 'setScope':
        this.#service.scope = message.scope === 'all' ? 'all' : 'repo';
        await this.refresh();
        return;
      case 'saveDraft':
        await this.#replyWith(message.requestId, await this.#saveComposer(message));
        return;
      case 'park':
        await catalog.global.update(message.id, { status: 'parked' });
        this.#service.fire();
        return;
      case 'discardDraft':
        await catalog.global.delete(message.id);
        this.#service.fire();
        return;
      case 'addImage': {
        if (!ALLOWED_IMAGES.has(message.mime)) throw new Error('That kind of image cannot be attached.');
        if (message.dataBase64.length > MAX_IMAGE_BASE64) throw new Error('That image is larger than the 25 MB limit.');
        const name = message.name || pastedImageName(message.mime);
        await this.#replyWith(message.requestId, await this.#attachToComposer(message, prompt => catalog.global.addBytes(prompt.id, Buffer.from(message.dataBase64, 'base64'), { name, mime: message.mime })));
        return;
      }
      case 'pickFiles': {
        const files = await vscode.window.showOpenDialog({ canSelectMany: true, title: 'Attach to parked prompt', openLabel: 'Attach' });
        if (!files?.length) {
          this.#post({ type: 'failed', requestId: message.requestId, message: '' });
          return;
        }
        await this.#replyWith(message.requestId, await this.#attachToComposer(message, async prompt => {
          let current = prompt;
          for (const file of files) current = await this.#actions.attachFile(current, file.fsPath);
          return current;
        }));
        return;
      }
      case 'removeAttachment': {
        const range = message.startLine && message.endLine ? { startLine: message.startLine, endLine: message.endLine } : undefined;
        await catalog.global.removeAttachment(message.id, message.path, range);
        this.#service.fire();
        return;
      }
      case 'restore':
        await this.#actions.restore(ref(message.ref), message.target);
        return;
      case 'copy':
        this.#post({ type: 'notice', message: '' });
        if (await this.#actions.copy(ref(message.ref))) this.#post({ type: 'notice', message: 'Copied prompt text. Attachments are not copied.' });
        return;
      case 'edit': {
        const view = this.#view;
        if (view) this.#post({ type: 'load', prompt: await this.#toView(await this.#service.get(ref(message.ref)), view.webview) });
        return;
      }
      case 'preview':
        await this.#preview.show(await this.#service.get(ref(message.ref)));
        return;
      case 'setStatus':
        await this.#actions.setStatus(ref(message.ref), message.status);
        return;
      case 'delete':
        await this.#actions.delete(ref(message.ref));
        return;
      case 'clearDone':
        if (message.scope !== this.#service.scope) throw new Error('The prompt list changed. Try clearing again.');
        await this.#actions.clearDone(message.refs.map(ref));
        return;
      case 'worktree':
        await this.#actions.runInWorktree(ref(message.ref));
        return;
      case 'moveToRepo':
        await this.#actions.moveToRepo(ref(message.ref));
        return;
      case 'openFile':
        await this.#actions.openAttachment(await this.#service.get(ref(message.ref)), message.path);
        return;
    }
  }
}
