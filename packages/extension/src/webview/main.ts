import type { ToWebview } from '../protocol.ts';
import { Composer } from './composer.ts';
import { h, post, settleRequest } from './dom.ts';
import { PromptList } from './list.ts';
import { Tips } from './tips.ts';

const notice = h('p', { class: 'notice', role: 'status', hidden: true });
const composer = new Composer();
const tips = new Tips();
const list = new PromptList(message => {
  void composer.preparePromptAction(message.ref).then(ready => {
    if (ready) post(message);
  }, (error: unknown) => {
    notice.textContent = `Could not use this prompt: ${error instanceof Error ? error.message : String(error)}`;
    notice.hidden = false;
  });
}, tips.button);

document.getElementById('app')?.append(tips.element, composer.element, notice, list.element);

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'state':
      composer.setModels(message.state.models);
      composer.syncFromList(message.state.prompts);
      list.update(message.state);
      tips.update(message.state);
      break;
    case 'saved':
    case 'failed':
      settleRequest(message);
      break;
    case 'load':
      void composer.load(message.prompt);
      break;
    case 'newPrompt':
      void composer.newPrompt();
      break;
    case 'notice':
      notice.textContent = message.message;
      notice.hidden = !message.message;
      break;
  }
});

post({ type: 'ready' });
