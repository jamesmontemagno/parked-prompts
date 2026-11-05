import type { AttachmentView, ModelOption, PromptView } from '../protocol.ts';
import { h, icon, post, request, vscodeApi } from './dom.ts';

const SAVE_DELAY_MS = 400;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface ComposerFields {
  id?: string | undefined;
  title: string;
  body: string;
  mode: string;
  model: string;
  /** The status of the prompt being edited. New prompts are drafts until parked. */
  status: PromptView['status'];
}

const emptyFields = (): ComposerFields => ({ title: '', body: '', mode: '', model: '', status: 'draft' });

const MODES = [
  { id: '', label: 'Default mode' },
  { id: 'agent', label: 'Agent' },
  { id: 'ask', label: 'Ask' },
  { id: 'edit', label: 'Edit' },
];

const readBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });

/** Writes a prompt and saves it as a draft as you type, so closing the window loses nothing. */
export class Composer {
  readonly element: HTMLElement;
  #fields: ComposerFields = emptyFields();
  #attachments: AttachmentView[] = [];
  #models: ModelOption[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Saves run one at a time, so a slow first save cannot create two drafts. */
  #queue: Promise<unknown> = Promise.resolve();
  readonly #title = h('input', { class: 'composer-title', type: 'text', placeholder: 'Title (optional)', 'aria-label': 'Title', maxLength: 200 });
  readonly #body = h('textarea', { class: 'composer-body', placeholder: 'Write a prompt to save for later. Paste images, or attach files.', 'aria-label': 'Prompt text', rows: 4 });
  readonly #chips = h('div', { class: 'chips' });
  readonly #mode = h('select', { 'aria-label': 'Mode' });
  readonly #model = h('select', { 'aria-label': 'Model' });
  readonly #status = h('span', { class: 'status', role: 'status' });
  readonly #park = h('button', { class: 'primary', type: 'button', onclick: () => void this.#parkNow() }, 'Park');
  readonly #discard = h('button', { class: 'quiet', type: 'button', onclick: () => void this.#discardNow() }, 'Discard');

  constructor() {
    const attach = h('button', { class: 'icon-button', type: 'button', title: 'Attach files', 'aria-label': 'Attach files', onclick: () => void this.#pickFiles() }, icon('attach'));
    this.#mode.append(...MODES.map(mode => h('option', { value: mode.id }, mode.label)));
    this.element = h(
      'section',
      { class: 'composer', 'aria-label': 'New prompt' },
      this.#title,
      this.#body,
      this.#chips,
      h('div', { class: 'composer-bar' }, attach, this.#mode, this.#model, h('span', { class: 'spacer' }), this.#status, this.#discard, this.#park),
    );
    for (const input of [this.#title, this.#body, this.#mode, this.#model]) input.addEventListener('input', () => this.#changed());
    this.#body.addEventListener('paste', event => this.#onPaste(event));
    this.#body.addEventListener('input', () => this.#grow());
    this.#body.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.#parkNow(); }
    });
    const saved = vscodeApi.getState() as (ComposerFields & { attachments?: AttachmentView[] }) | undefined;
    if (saved?.id || saved?.body || saved?.title) {
      this.#fields = { ...emptyFields(), ...saved };
      this.#attachments = saved.attachments ?? [];
    }
    this.#render();
  }

  setModels(models: ModelOption[]): void {
    this.#models = models;
    const selected = this.#fields.model;
    const options = [{ id: '', label: 'Default model' }, ...models];
    // A saved model that is not available here still shows, rather than silently changing.
    if (selected && !models.some(model => model.id === selected)) options.push({ id: selected, label: `${selected} (unavailable)` });
    this.#model.replaceChildren(...options.map(model => h('option', { value: model.id }, model.label)));
    this.#model.value = selected;
    this.#model.hidden = this.#models.length === 0 && !selected;
  }

  focus(): void {
    this.#body.focus();
  }

  /** Follows the list: a prompt being edited can change or vanish elsewhere. */
  syncFromList(prompts: readonly PromptView[]): void {
    const { id } = this.#fields;
    if (!id) return;
    const match = prompts.find(prompt => prompt.id === id && prompt.store === 'global');
    if (match) {
      this.#attachments = match.attachments;
      this.#renderChips();
    }
  }

  async load(prompt: PromptView): Promise<void> {
    await this.#flush();
    this.#fields = { id: prompt.id, title: prompt.title, body: prompt.body, mode: prompt.mode ?? '', model: prompt.model ?? '', status: prompt.status };
    this.#attachments = prompt.attachments;
    this.#setStatus(prompt.status === 'draft' ? 'Draft' : 'Editing');
    this.#render();
    this.focus();
  }

  async newPrompt(): Promise<void> {
    await this.#flush();
    this.#reset();
    this.focus();
  }

  #reset(): void {
    this.#fields = emptyFields();
    this.#attachments = [];
    this.#setStatus('');
    this.#render();
  }

  #render(): void {
    this.#title.value = this.#fields.title;
    this.#body.value = this.#fields.body;
    this.#mode.value = this.#fields.mode;
    this.setModels(this.#models);
    this.#renderChips();
    this.#updateButtons();
    this.#grow();
    this.#persist();
  }

  #grow(): void {
    this.#body.style.height = 'auto';
    this.#body.style.height = `${Math.min(this.#body.scrollHeight + 2, 320)}px`;
  }

  #persist(): void {
    vscodeApi.setState({ ...this.#fields, attachments: this.#attachments });
  }

  #renderChips(): void {
    this.#chips.replaceChildren(...this.#attachments.map(item => this.#chip(item)));
    this.#chips.hidden = this.#attachments.length === 0;
    this.#updateButtons();
    this.#persist();
  }

  #chip(item: AttachmentView): HTMLElement {
    const remove = h('button', { class: 'chip-remove', type: 'button', title: `Remove ${item.label}`, 'aria-label': `Remove ${item.label}`, onclick: () => this.#remove(item) }, icon('close'));
    const media = item.imageUrl ? h('img', { class: 'chip-thumb', src: item.imageUrl, alt: '' }) : item.missing ? icon('warn') : icon('file');
    return h('div', { class: item.missing ? 'chip missing' : 'chip', title: item.missing ? `${item.label}: not found` : item.label }, media, h('span', { class: 'chip-label' }, item.label), remove);
  }

  #remove(item: AttachmentView): void {
    const { id } = this.#fields;
    if (!id) return;
    this.#attachments = this.#attachments.filter(other => other !== item);
    this.#renderChips();
    post({ type: 'removeAttachment', id, path: item.path, ...(item.startLine && item.endLine && { startLine: item.startLine, endLine: item.endLine }) });
  }

  #updateButtons(): void {
    const hasContent = this.#fields.body.trim().length > 0 || this.#attachments.length > 0;
    this.#park.disabled = !hasContent;
    this.#park.textContent = this.#fields.status === 'draft' ? 'Park' : 'Done editing';
    this.#discard.hidden = !this.#fields.id || this.#fields.status !== 'draft';
  }

  #setStatus(text: string): void {
    this.#status.textContent = text;
  }

  #readInputs(): void {
    Object.assign(this.#fields, { title: this.#title.value, body: this.#body.value, mode: this.#mode.value, model: this.#model.value });
  }

  #changed(): void {
    this.#readInputs();
    this.#updateButtons();
    this.#persist();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#save(), SAVE_DELAY_MS);
  }

  #payload() {
    const { id, title, body, mode, model } = this.#fields;
    return { ...(id && { id }), title, body, mode, model };
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** Resolves to whether the text is safely stored. A failure keeps it in the composer. */
  #save(): Promise<boolean> {
    return this.#enqueue(async () => {
      const fields = this.#fields;
      const { id, body, title } = fields;
      if (!id && !body.trim() && !title.trim()) return true;
      let reply;
      try {
        reply = await request(requestId => ({ type: 'saveDraft', requestId, ...this.#payload() }));
      } catch (error) {
        if ((error as { code?: string }).code !== 'not_found') throw error;
        // It was deleted somewhere else. The text in front of the user still matters, so keep it as a new draft.
        fields.id = undefined;
        fields.status = 'draft';
        reply = await request(requestId => ({ type: 'saveDraft', requestId, ...this.#payload() }));
      }
      // The composer may have moved on to another prompt while this was saving.
      fields.id = reply.id;
      if (this.#fields !== fields) return true;
      this.#setStatus(fields.status === 'draft' ? 'Draft saved' : 'Saved');
      this.#updateButtons();
      this.#persist();
      return true;
    }).catch(error => {
      this.#setStatus(`Not saved: ${error.message}`);
      return false;
    });
  }

  async #flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      await this.#save();
    }
    await this.#queue;
  }

  async #parkNow(): Promise<void> {
    this.#readInputs();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!(await this.#save())) return;
    const { id, status } = this.#fields;
    if (!id) return;
    if (status === 'draft') post({ type: 'park', id });
    this.#reset();
    this.#setStatus(status === 'draft' ? 'Parked' : 'Saved');
    this.focus();
  }

  async #discardNow(): Promise<void> {
    await this.#flush();
    const { id } = this.#fields;
    if (id) post({ type: 'discardDraft', id });
    this.#reset();
  }

  #applyAttachmentReply(reply: { id: string; prompt?: PromptView }): void {
    this.#fields.id = reply.id;
    if (reply.prompt) this.#attachments = reply.prompt.attachments;
    this.#setStatus('Attached');
    this.#renderChips();
  }

  #pickFiles(): Promise<void> {
    this.#readInputs();
    return this.#enqueue(async () => {
      const reply = await request(requestId => ({ type: 'pickFiles', requestId, ...this.#payload() }));
      this.#applyAttachmentReply(reply);
    }).catch(error => this.#setStatus(error.message));
  }

  #onPaste(event: ClipboardEvent): void {
    const images = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (images.length === 0) return;
    event.preventDefault();
    for (const item of images) {
      const file = item.getAsFile();
      if (file) void this.#addImage(file);
    }
  }

  #addImage(file: File): Promise<void> {
    this.#readInputs();
    this.#setStatus('Attaching…');
    return this.#enqueue(async () => {
      if (file.size > MAX_IMAGE_BYTES) throw new Error('That image is larger than the 25 MB limit.');
      const dataBase64 = await readBase64(file);
      const reply = await request(requestId => ({ type: 'addImage', requestId, ...this.#payload(), mime: file.type, dataBase64, ...(file.name && file.name !== 'image.png' && { name: file.name }) }));
      this.#applyAttachmentReply(reply);
    }).catch(error => this.#setStatus(error.message));
  }
}
