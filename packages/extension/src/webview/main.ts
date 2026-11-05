import type { ToWebview } from '../protocol.ts';
import { Composer } from './composer.ts';
import { h, post, settleRequest } from './dom.ts';
import { PromptList } from './list.ts';

const composer = new Composer();
const list = new PromptList();
const notice = h('p', { class: 'notice', role: 'status', hidden: true });

document.getElementById('app')?.append(composer.element, notice, list.element);

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'state':
      composer.setModels(message.state.models);
      composer.syncFromList(message.state.prompts);
      list.update(message.state);
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
