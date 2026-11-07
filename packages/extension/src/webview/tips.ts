import type { ViewState } from '../protocol.ts';
import { h, icon, post } from './dom.ts';

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

const TIPS: readonly (readonly [string, string])[] = [
  ['Write it, park it.', 'Drafts save as you type. Park sets a prompt aside until you need it.'],
  ['Images and files.', 'Paste an image into the text, or attach files with the paperclip.'],
  ['Draft in chat.', 'The chat button puts a prompt in Copilot Chat with its model and files. It never sends.'],
  ['Park from chat.', `Press ${isMac ? '⌘⌥P' : 'Ctrl+Alt+P'} in the chat box to park what you typed. Text only: attachments stay in chat.`],
  ['This repo or All.', 'Prompts belong to the repository you saved them in. Choose All to see every one.'],
  ['Repository prompts.', 'Prompts stored in the repository arrived by Git, so review them before using them.'],
];

/** First-run tips, reopened from the info button. It never blocks the rest of the view. */
export class Tips {
  readonly #title = h('h2', { class: 'tips-title', id: 'tips-title', tabIndex: -1 }, 'Tips for Parked Prompts');
  readonly element = h('section', { class: 'tips', id: 'parked-tips', 'aria-labelledby': 'tips-title', hidden: true });
  readonly button = h('button', {
    class: 'icon-button',
    type: 'button',
    title: 'Tips and key features',
    'aria-label': 'Tips and key features',
    'aria-expanded': 'false',
    'aria-controls': 'parked-tips',
    onclick: () => (this.element.hidden ? this.#open(true) : this.#close()),
  }, icon('info'));
  #firstRun = false;
  #autoShown = false;

  constructor() {
    const close = h('button', { class: 'icon-button', type: 'button', title: 'Close tips', 'aria-label': 'Close tips', onclick: () => this.#close() }, icon('close'));
    this.element.append(
      h('div', { class: 'tips-head' }, icon('info'), this.#title, close),
      h('ul', { class: 'tips-list' }, ...TIPS.map(([lead, text]) => h('li', {}, h('strong', {}, lead), ' ', text))),
      h('div', { class: 'tips-foot' }, h('span', { class: 'muted' }, 'Reopen these from the info button.'), h('button', { class: 'primary', type: 'button', onclick: () => this.#close() }, 'Got it')),
    );
    this.element.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.#close();
      }
    });
  }

  update(state: ViewState): void {
    this.#firstRun = state.showTips === true;
    if (this.#firstRun && !this.#autoShown) {
      this.#autoShown = true;
      // Shown without taking focus, so it does not interrupt someone already typing.
      this.#open(false);
    }
  }

  #open(focus: boolean): void {
    this.element.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    if (focus) this.#title.focus();
  }

  #close(): void {
    const hadFocus = this.element.contains(document.activeElement);
    this.element.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (this.#firstRun) {
      this.#firstRun = false;
      post({ type: 'dismissTips' });
    }
    if (hadFocus) this.button.focus();
  }
}
