// Talks to VS Code over the Chrome DevTools Protocol, and to the spike extension over HTTP.
export const api = async (path, body) =>
  (await fetch(`http://127.0.0.1:9444${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)).json();

export const exec = (command, ...args) => api('/exec', { command, args });
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function target(match) {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = list.find(item => item.type === 'page' && item.url.includes(match));
  if (!page) throw new Error(`No window matching ${match}. Windows: ${list.map(item => item.url.slice(-40))}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) => new Promise(resolve => { id += 1; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  return {
    evaluate: async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value,
    click: async (x, y) => {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    },
    close: () => socket.close(),
  };
}

let failures = 0;
export function check(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!passed) failures += 1;
}
export const finish = () => process.exit(failures > 0 ? 1 : 0);

/** The text and attachments of each visible chat input. */
export const CHAT_DOM = `JSON.stringify([...document.querySelectorAll('.interactive-input-part')].filter(e => e.offsetParent !== null).map(p => ({
  text: p.querySelector('.view-lines')?.innerText?.replace(/\\u00a0/g, ' ') ?? '',
  attachments: [...p.querySelectorAll('.chat-attached-context-attachment')].map(a => a.getAttribute('aria-label')),
})))`;
