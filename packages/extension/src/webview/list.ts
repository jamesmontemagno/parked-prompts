import type { PromptView, ViewState } from '../protocol.ts';
import { closeMenu, h, icon, post, showMenu, timeAgo, type MenuItem } from './dom.ts';

const matches = (prompt: PromptView, query: string) => {
  if (!query) return true;
  const haystack = `${prompt.title}\n${prompt.body}\n${prompt.repoLabel ?? ''}\n${prompt.attachments.map(item => item.label).join('\n')}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every(word => haystack.includes(word));
};

const refOf = (prompt: PromptView) => ({ id: prompt.id, store: prompt.store });

function menuFor(prompt: PromptView, state: ViewState): MenuItem[] {
  const ref = refOf(prompt);
  const items: MenuItem[] = [];
  const otherTarget = state.restoreTarget === 'newChat' ? 'currentChat' : 'newChat';
  items.push({ label: otherTarget === 'newChat' ? 'Restore to a new chat' : 'Restore to the current chat', run: () => post({ type: 'restore', ref, target: otherTarget }) });
  if (state.trusted && state.isGitRepo) items.push({ label: 'Run in a worktree…', run: () => post({ type: 'worktree', ref }) });
  items.push({ label: 'Show the text', run: () => post({ type: 'preview', ref }) });
  if (prompt.store === 'global') {
    items.push({ label: 'Edit', run: () => post({ type: 'edit', ref }) });
    if (state.trusted && state.isGitRepo) items.push({ label: 'Move to repository…', run: () => post({ type: 'moveToRepo', ref }) });
  }
  items.push(
    prompt.status === 'done'
      ? { label: 'Reopen', run: () => post({ type: 'setStatus', ref, status: 'parked' }) }
      : { label: 'Mark as done', run: () => post({ type: 'setStatus', ref, status: 'done' }) },
  );
  items.push({ label: 'Delete…', danger: true, run: () => post({ type: 'delete', ref }) });
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

function row(prompt: PromptView, state: ViewState): HTMLElement {
  const more: HTMLButtonElement = h('button', { class: 'icon-button', type: 'button', title: 'More actions', 'aria-label': `More actions for ${prompt.title}`, 'aria-haspopup': 'menu', onclick: () => showMenu(more, menuFor(prompt, state)) }, icon('more'));
  const restore = h(
    'button',
    { class: prompt.needsConfirmation ? 'secondary' : 'primary-quiet', type: 'button', title: prompt.needsConfirmation ? 'Read it, then choose whether to use it' : 'Put it in the chat input. It is not sent.', onclick: () => post({ type: 'restore', ref: refOf(prompt) }) },
    prompt.needsConfirmation ? 'Review' : 'Restore',
  );
  const badges = [
    prompt.store === 'repo' && h('span', { class: 'badge repo', title: 'Stored in the repository. It arrived by Git, so read it before using it.' }, 'Repo'),
    prompt.warnings.length > 0 && h('span', { class: 'badge warn', title: prompt.warnings.join('\n') }, 'Check'),
  ];
  const meta = [state.scope === 'all' || !prompt.inCurrentRepo ? prompt.repoLabel : undefined, timeAgo(prompt.updatedAt)].filter(Boolean).join(' · ');
  return h(
    'li',
    { class: `prompt status-${prompt.status}` },
    h('div', { class: 'prompt-head' }, h('span', { class: 'prompt-title', title: prompt.title }, prompt.title), ...badges),
    prompt.excerpt && prompt.excerpt !== prompt.title ? h('p', { class: 'prompt-excerpt' }, prompt.excerpt) : null,
    attachmentRow(prompt),
    h('div', { class: 'prompt-foot' }, h('span', { class: 'muted time' }, meta), h('span', { class: 'spacer' }), restore, more),
  );
}

function group(title: string, prompts: PromptView[], state: ViewState, collapsed = false): HTMLElement | undefined {
  if (prompts.length === 0) return undefined;
  const list = h('ul', { class: 'prompts' }, ...prompts.map(prompt => row(prompt, state)));
  const label = `${title} (${prompts.length})`;
  if (collapsed) return h('details', { class: 'group' }, h('summary', { class: 'group-title' }, label), list);
  return h('section', { class: 'group', 'aria-label': title }, h('h2', { class: 'group-title' }, label), list);
}

/** Search, the repo filter, and the prompts grouped by status. */
export class PromptList {
  readonly element = h('section', { class: 'list', 'aria-label': 'Parked prompts' });
  readonly #search = h('input', { class: 'search', type: 'search', placeholder: 'Search', 'aria-label': 'Search parked prompts' });
  readonly #scopes = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Which prompts to show' });
  readonly #content = h('div');
  #state: ViewState | undefined;
  /** Done groups stay as the user left them when the list refreshes. */
  #doneOpen = false;

  constructor() {
    this.#search.addEventListener('input', () => this.#renderContent());
    this.element.append(h('div', { class: 'list-head' }, this.#search, this.#scopes), this.#content);
  }

  update(state: ViewState): void {
    this.#state = state;
    closeMenu();
    const scope = (value: 'repo' | 'all', label: string) =>
      h('button', { type: 'button', class: state.scope === value ? 'selected' : '', 'aria-pressed': String(state.scope === value), onclick: () => post({ type: 'setScope', scope: value }) }, label);
    this.#scopes.replaceChildren(scope('repo', state.repoLabel ? 'This repo' : 'No repo'), scope('all', 'All'));
    this.#renderContent();
  }

  #renderContent(): void {
    const state = this.#state;
    if (!state) return;
    const open = this.#content.querySelector('details');
    if (open) this.#doneOpen = open.open;
    const query = this.#search.value.trim();
    const shown = state.prompts.filter(prompt => matches(prompt, query));
    const parts: (HTMLElement | undefined)[] = [];
    if (!state.trusted) parts.push(h('p', { class: 'banner' }, 'This workspace is not trusted, so prompts stored in the repository are hidden.'));
    parts.push(
      group('Drafts', shown.filter(prompt => prompt.status === 'draft'), state),
      group('Parked', shown.filter(prompt => prompt.status === 'parked'), state),
      group('Done', shown.filter(prompt => prompt.status === 'done'), state, true),
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
    const done = [...this.#content.querySelectorAll('details.group')][0] as HTMLDetailsElement | undefined;
    if (done) done.open = this.#doneOpen;
  }
}
