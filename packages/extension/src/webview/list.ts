import { repoDisplayName } from '@parked-prompts/core/remote';
import type { PromptRefMessage, PromptView, ToHost, ViewState } from '../protocol.ts';
import { h, icon, isMenuOpen, onMenuClosed, post, showMenu, timeAgo, type MenuItem } from './dom.ts';

type PromptAction = Extract<ToHost, { ref: PromptRefMessage }>;
type DispatchPrompt = (message: PromptAction) => void;

const modelName = (prompt: PromptView, state: ViewState) =>
  prompt.model ? state.models.find(model => model.id === prompt.model)?.label ?? prompt.model : undefined;

const matches = (prompt: PromptView, state: ViewState, query: string) => {
  if (!query) return true;
  const haystack = `${prompt.title}\n${prompt.body}\n${prompt.repoLabel ?? ''}\n${prompt.model ?? ''}\n${modelName(prompt, state) ?? ''}\n${prompt.attachments.map(item => item.label).join('\n')}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every(word => haystack.includes(word));
};

const refOf = (prompt: PromptView) => ({ id: prompt.id, store: prompt.store });

function menuFor(prompt: PromptView, state: ViewState, dispatch: DispatchPrompt): MenuItem[] {
  const ref = refOf(prompt);
  const items: MenuItem[] = [];
  const otherTarget = state.restoreTarget === 'newChat' ? 'currentChat' : 'newChat';
  items.push({ label: otherTarget === 'newChat' ? 'Restore to a new chat' : 'Restore to the current chat', run: () => dispatch({ type: 'restore', ref, target: otherTarget }) });
  if (state.trusted && state.isGitRepo) items.push({ label: 'Run in a worktree…', run: () => dispatch({ type: 'worktree', ref }) });
  items.push({ label: 'Show the text', run: () => dispatch({ type: 'preview', ref }) });
  if (prompt.store === 'global') {
    items.push({ label: 'Edit', run: () => dispatch({ type: 'edit', ref }) });
    if (state.trusted && state.isGitRepo) items.push({ label: 'Move to repository…', run: () => dispatch({ type: 'moveToRepo', ref }) });
  }
  items.push(
    prompt.status === 'done'
      ? { label: 'Reopen', run: () => dispatch({ type: 'setStatus', ref, status: 'parked' }) }
      : { label: 'Mark as done', run: () => dispatch({ type: 'setStatus', ref, status: 'done' }) },
  );
  items.push({ label: 'Delete…', danger: true, run: () => dispatch({ type: 'delete', ref }) });
  return items;
}

function attachmentRow(prompt: PromptView): HTMLElement | undefined {
  if (prompt.attachments.length === 0) return undefined;
  const missing = prompt.attachments.filter(item => item.missing && item.missing !== 'no-workspace').length;
  const unavailable = prompt.attachments.filter(item => item.missing === 'no-workspace').length;
  const images = prompt.attachments.filter(item => item.imageUrl).slice(0, 4);
  return h(
    'div',
    { class: 'row-attachments' },
    ...images.map(item => h('img', { class: 'thumb', src: item.imageUrl as string, alt: item.label, title: item.label })),
    h('span', { class: 'muted' }, `${prompt.attachments.length} attached`),
    missing > 0 && h('span', { class: 'warn', title: prompt.attachments.filter(item => item.missing).map(item => item.label).join(', ') }, icon('warn'), `${missing} missing`),
    unavailable > 0 && h('span', { class: 'muted', title: 'These workspace files resolve when the prompt\u2019s repository is open.' }, `${unavailable} in another workspace`),
  );
}

function modelChip(prompt: PromptView, state: ViewState): HTMLElement | undefined {
  const name = modelName(prompt, state);
  if (!prompt.model || !name) return undefined;
  const available = state.models.some(model => model.id === prompt.model);
  const title = available
    ? `Model: ${name} (${prompt.model}). Drafting in chat selects it.`
    : `Model: ${prompt.model}. It is not available here, so drafting in chat uses the current model.`;
  return h('span', { class: available ? 'model-chip' : 'model-chip unavailable', title },
    icon('sparkle'),
    h('span', { class: 'sr-only' }, 'Model: '),
    h('span', { class: 'model-name' }, name));
}

/** The excerpt, without repeating a title that came from the same text. */
const summaryOf = (prompt: PromptView): string => {
  const title = prompt.title.replace(/…$/, '');
  return prompt.excerpt.startsWith(title) ? prompt.excerpt.slice(title.length).trim() : prompt.excerpt;
};

function row(prompt: PromptView, state: ViewState, dispatch: DispatchPrompt): HTMLElement {
  const more: HTMLButtonElement = h('button', { class: 'icon-button', type: 'button', title: 'More actions', 'aria-label': `More actions for ${prompt.title}`, 'aria-haspopup': 'menu', onclick: () => showMenu(more, menuFor(prompt, state, dispatch)) }, icon('more'));
  const destination = state.restoreTarget === 'currentChat' ? 'the current chat' : 'a new chat';
  const restore = h('button', {
    class: 'icon-button chat-action',
    type: 'button',
    title: prompt.needsConfirmation ? `Review before drafting in ${destination}. It is not sent.` : `Draft in ${destination}. It is not sent.`,
    'aria-label': `${prompt.needsConfirmation ? 'Review and draft' : 'Draft'} in chat: ${prompt.title}`,
    onclick: () => dispatch({ type: 'restore', ref: refOf(prompt) }),
  }, icon('chat'));
  const copy = h('button', {
    class: 'icon-button',
    type: 'button',
    title: prompt.needsConfirmation ? 'Review before copying the prompt text. Attachments are not copied.' : 'Copy prompt text. Attachments are not copied.',
    'aria-label': `Copy prompt text: ${prompt.title}`,
    onclick: () => dispatch({ type: 'copy', ref: refOf(prompt) }),
  }, icon('copy'));
  const edit = prompt.store === 'global' && h('button', {
    class: 'icon-button',
    type: 'button',
    title: 'Edit in the Parked Prompts composer',
    'aria-label': `Edit: ${prompt.title}`,
    onclick: () => dispatch({ type: 'edit', ref: refOf(prompt) }),
  }, icon('edit'));
  const remove = h('button', {
    class: 'icon-button',
    type: 'button',
    title: 'Delete this prompt and its copied attachments after confirmation',
    'aria-label': `Delete: ${prompt.title}`,
    onclick: () => dispatch({ type: 'delete', ref: refOf(prompt) }),
  }, icon('trash'));
  const badges = [
    prompt.store === 'repo' && h('span', { class: 'badge repo', title: 'Stored in the repository. It arrived by Git, so read it before using it.' }, 'Repo'),
    prompt.warnings.length > 0 && h('span', { class: 'badge warn', title: prompt.warnings.join('\n') }, 'Check'),
    modelChip(prompt, state),
  ];
  const repoLabel = state.scope === 'all' || !prompt.inCurrentRepo ? prompt.repoLabel : undefined;
  const meta = h('span', { class: 'muted time' },
    repoLabel && h('span', { title: repoLabel },
      h('span', { 'aria-hidden': 'true' }, repoDisplayName(repoLabel)),
      h('span', { class: 'sr-only' }, repoLabel)),
    repoLabel && ' · ',
    timeAgo(prompt.updatedAt),
  );
  return h(
    'li',
    { class: `prompt status-${prompt.status}` },
    h('div', { class: 'prompt-head' }, h('span', { class: 'prompt-title', title: prompt.title }, prompt.title), ...badges),
    summaryOf(prompt) ? h('p', { class: 'prompt-excerpt' }, summaryOf(prompt)) : null,
    attachmentRow(prompt),
    h('div', { class: 'prompt-foot' }, meta, h('span', { class: 'spacer' }), restore, edit, copy, remove, more),
  );
}

function group(title: string, prompts: PromptView[], state: ViewState, dispatch: DispatchPrompt, collapsed = false): HTMLElement | undefined {
  if (prompts.length === 0) return undefined;
  const list = h('ul', { class: 'prompts' }, ...prompts.map(prompt => row(prompt, state, dispatch)));
  const label = `${title} (${prompts.length})`;
  if (collapsed) {
    // Only what is shown is cleared, so a search narrows it and hidden prompts are kept.
    const sweep = h('button', {
      class: 'icon-button group-action',
      type: 'button',
      title: 'Clear shown completed prompts',
      'aria-label': 'Clear done',
      onclick: () => post({ type: 'clearDone', scope: state.scope, refs: prompts.map(refOf) }),
    }, icon('sweep'));
    return h('div', { class: 'group done-group' }, sweep, h('details', { class: 'done-details' }, h('summary', { class: 'group-title' }, label), list));
  }
  return h('section', { class: 'group', 'aria-label': title }, h('h2', { class: 'group-title' }, label), list);
}

/** Search, the repo filter, and the prompts grouped by status. */
export class PromptList {
  readonly element = h('section', { class: 'list', 'aria-label': 'Parked prompts' });
  readonly #search = h('input', { class: 'search', type: 'search', placeholder: 'Search', 'aria-label': 'Search parked prompts' });
  readonly #scopes = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Which prompts to show' });
  readonly #content = h('div');
  readonly #dispatch: DispatchPrompt;
  #state: ViewState | undefined;
  /** Done groups stay as the user left them when the list refreshes. */
  #doneOpen = false;

  /** What was last drawn, so a refresh with nothing new leaves the page alone. */
  #drawn = '';
  #pressed = false;
  #waiting = false;

  constructor(dispatch: DispatchPrompt, ...headControls: HTMLElement[]) {
    this.#dispatch = dispatch;
    this.#search.addEventListener('input', () => this.#renderContent());
    this.element.append(h('div', { class: 'list-head' }, this.#search, this.#scopes, ...headControls), this.#content);
    // Replacing a row while it is being clicked loses the click, so changes wait for the press to end.
    this.#content.addEventListener('pointerdown', () => { this.#pressed = true; });
    document.addEventListener('pointerup', () => {
      this.#pressed = false;
      setTimeout(() => this.#flush(), 50);
    });
    onMenuClosed(() => this.#flush());
  }

  update(state: ViewState): void {
    this.#state = state;
    this.#waiting = true;
    this.#flush();
  }

  /** The store changes whenever anything saves, including the composer, so this runs often. */
  #flush(): void {
    const state = this.#state;
    if (!state || !this.#waiting || this.#pressed || isMenuOpen()) return;
    this.#waiting = false;
    // Minutes are part of it, so "5m ago" still moves on.
    const drawn = JSON.stringify([state, Math.floor(Date.now() / 60_000)]);
    if (drawn === this.#drawn) return;
    this.#drawn = drawn;
    const scope = (value: 'repo' | 'all', label: string, fullLabel?: string) =>
      h('button', { type: 'button', class: state.scope === value ? 'selected' : '', 'aria-pressed': String(state.scope === value), ...(fullLabel ? { title: fullLabel, 'aria-label': fullLabel } : {}), onclick: () => post({ type: 'setScope', scope: value }) }, label);
    this.#scopes.replaceChildren(scope('repo', state.repoLabel ? repoDisplayName(state.repoLabel) : 'No repo', state.repoLabel), scope('all', 'All'));
    this.#renderContent();
  }

  #renderContent(): void {
    const state = this.#state;
    if (!state) return;
    const open = this.#content.querySelector<HTMLDetailsElement>('details.done-details');
    if (open) this.#doneOpen = open.open;
    const query = this.#search.value.trim();
    const shown = state.prompts.filter(prompt => matches(prompt, state, query));
    const parts: (HTMLElement | undefined)[] = [];
    if (!state.trusted) parts.push(h('p', { class: 'banner' }, 'This workspace is not trusted, so prompts stored in the repository are hidden.'));
    parts.push(
      group('Drafts', shown.filter(prompt => prompt.status === 'draft'), state, this.#dispatch),
      group('Parked', shown.filter(prompt => prompt.status === 'parked'), state, this.#dispatch),
      group('Done', shown.filter(prompt => prompt.status === 'done'), state, this.#dispatch, true),
    );
    if (shown.length === 0) {
      parts.push(h('p', { class: 'empty' }, query ? 'Nothing matches that search.' : state.scope === 'repo' ? 'Nothing parked for this repository yet.' : 'Nothing parked yet.'));
    }
    if (state.problems.length > 0) {
      parts.push(
        h(
          'details',
          { class: 'problems' },
          h('summary', {}, `${state.problems.length} entr${state.problems.length === 1 ? 'y' : 'ies'} could not be read`),
          h('ul', {}, ...state.problems.map(problem => h('li', {}, `${problem.id}: ${problem.reason}`))),
        ),
      );
    }
    this.#content.replaceChildren(...parts.filter((part): part is HTMLElement => Boolean(part)));
    const done = this.#content.querySelector<HTMLDetailsElement>('details.done-details');
    if (done) done.open = this.#doneOpen;
  }
}
