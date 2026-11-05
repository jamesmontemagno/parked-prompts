import * as vscode from 'vscode';
import { contentHash, previewUntrusted, type ParkedPrompt } from '@parked-prompts/core';
import type { ParkedService } from './service.ts';

const PREVIEW_SCHEME = 'parked-prompt-preview';

/** Shows prompt content read-only. Nothing in it is run, sent, or rendered as Markdown. */
export class PromptPreview implements vscode.TextDocumentContentProvider, vscode.Disposable {
  readonly #contents = new Map<string, string>();
  readonly #changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.#changed.event;
  readonly #registration: vscode.Disposable;

  constructor() {
    this.#registration = vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, this);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.#contents.get(uri.toString()) ?? '';
  }

  async show(prompt: ParkedPrompt): Promise<void> {
    const preview = await previewUntrusted(prompt);
    const lines = [
      `Title: ${prompt.title}`,
      `From: ${prompt.store === 'repo' ? 'the repository (arrived by Git, not written by you)' : 'your parked prompts'}`,
      ...(preview.attachments.length > 0 ? [`Attachments: ${preview.attachments.join(', ')}`] : []),
      ...preview.warnings.map(warning => `Warning: ${warning}`),
      '',
      '----- prompt text -----',
      '',
      preview.text,
    ];
    const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${prompt.id}.txt` });
    this.#contents.set(uri.toString(), lines.join('\n'));
    this.#changed.fire(uri);
    await vscode.window.showTextDocument(uri, { preview: true, viewColumn: vscode.ViewColumn.Active });
  }

  dispose(): void {
    this.#registration.dispose();
    this.#changed.dispose();
  }
}

/**
 * Prompts that arrive by Git are shown first and never used without saying yes. A yes
 * covers this exact content: any change asks again.
 */
export async function confirmRepoPrompt(service: ParkedService, preview: PromptPreview, prompt: ParkedPrompt): Promise<boolean> {
  if (prompt.store !== 'repo') return true;
  if (!(await service.catalog.trust.needsConfirmation(prompt))) return true;
  await preview.show(prompt);
  const review = await previewUntrusted(prompt);
  const detail = [
    'This prompt is stored in the repository, so anyone with commit access could have written it. Read it before using it, as it will instruct your agent.',
    ...review.warnings,
  ].join('\n\n');
  const accept = 'I Read It, Use It';
  const answer = await vscode.window.showWarningMessage(`Use "${prompt.title}" from the repository?`, { modal: true, detail }, accept);
  if (answer !== accept) return false;
  // Hash again, in case it changed while the question was open.
  const hash = await contentHash(await service.get({ store: prompt.store, id: prompt.id }));
  if (hash !== review.hash) {
    void vscode.window.showWarningMessage('The prompt changed while you were reading it. Review it again.');
    return false;
  }
  await service.catalog.trust.confirm(hash, prompt.id);
  return true;
}
