import * as vscode from 'vscode';
import { errorMessage, type ParkedPrompt, type PromptRef } from '@parked-prompts/core';
import { chatHost, PromptActions } from './actions.ts';
import { detectSurface } from './chatAdapter.ts';
import { ParkedService } from './service.ts';
import { PromptPreview } from './trustFlow.ts';
import { ParkedViewProvider } from './view.ts';

/** What tests can reach. Nothing else uses it. */
export interface ParkedPromptsApi {
  service: ParkedService;
  actions: PromptActions;
}

const report = (error: unknown) => void vscode.window.showErrorMessage(errorMessage(error));

export async function activate(context: vscode.ExtensionContext): Promise<ParkedPromptsApi> {
  const service = await ParkedService.create();
  const preview = new PromptPreview();
  const actions = new PromptActions(service, preview);
  const view = new ParkedViewProvider(context.extensionUri, service, actions, preview);
  const surface = await detectSurface(chatHost);
  await vscode.commands.executeCommand('setContext', 'parkedPrompts.isAgentsWindow', surface === 'agents-window');

  /** A command takes a prompt from the view, or asks which one when run from the palette. */
  const withPrompt = (title: string, run: (ref: PromptRef) => unknown, accept?: (prompt: ParkedPrompt) => boolean) => async (ref?: PromptRef) => {
    const chosen = ref ?? (await actions.pick(title, accept));
    if (chosen) await run(chosen);
  };

  const commands: Record<string, (...args: never[]) => unknown> = {
    'parkedPrompts.new': () => (surface === 'agents-window' ? actions.parkFromInput() : view.focusComposer()),
    'parkedPrompts.parkTyped': () => actions.parkTyped(),
    'parkedPrompts.parkSelection': () => actions.parkSelection(),
    'parkedPrompts.parkFile': (resource?: vscode.Uri) => actions.parkFile(resource),
    'parkedPrompts.restore': withPrompt('Restore a parked prompt', ref => actions.restore(ref), prompt => prompt.status !== 'done'),
    'parkedPrompts.restoreToCurrent': withPrompt('Restore to the current chat', ref => actions.restore(ref, 'currentChat'), prompt => prompt.status !== 'done'),
    'parkedPrompts.markDone': withPrompt('Mark as done', ref => actions.setStatus(ref, 'done'), prompt => prompt.status !== 'done'),
    'parkedPrompts.reopen': withPrompt('Reopen', ref => actions.setStatus(ref, 'parked'), prompt => prompt.status === 'done'),
    'parkedPrompts.delete': withPrompt('Delete a parked prompt', ref => actions.delete(ref)),
    'parkedPrompts.runInWorktree': withPrompt('Run in a worktree', ref => actions.runInWorktree(ref), prompt => prompt.status !== 'done'),
    'parkedPrompts.moveToRepo': withPrompt('Move to the repository', ref => actions.moveToRepo(ref), prompt => prompt.store === 'global'),
    'parkedPrompts.openStore': () => actions.openStore(),
    'parkedPrompts.refresh': () => service.reload(),
  };

  context.subscriptions.push(
    service,
    preview,
    actions,
    view,
    vscode.window.registerWebviewViewProvider(ParkedViewProvider.viewId, view, { webviewOptions: { retainContextWhenHidden: true } }),
    ...Object.entries(commands).map(([id, handler]) =>
      vscode.commands.registerCommand(id, async (...args: never[]) => {
        try {
          return await handler(...args);
        } catch (error) {
          report(error);
          return undefined;
        }
      }),
    ),
  );

  void service.catalog.global.sweep().catch(() => undefined);
  // A worktree window opens before chat is ready, so give it a moment.
  setTimeout(() => void actions.restorePending().catch(report), 1500);
  return { service, actions };
}

export function deactivate(): void {}
