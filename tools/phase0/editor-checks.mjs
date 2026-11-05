// Checks A, C, D, and E in the main window. Start VS Code with ./launch.sh first.
import { api, check, CHAT_DOM, exec, finish, sleep, target } from './lib.mjs';

const WS = `${process.env.PHASE0_DIR ?? '/tmp/phase0'}/ws`;
const file = { $file: `${WS}/src/sample.ts` };
const image = { $file: `${WS}/shot.png` };
const page = await target('workbench.html');
const inputs = async () => JSON.parse(await page.evaluate(CHAT_DOM));
const hasText = (list, text) => list.some(input => input.text.includes(text));

// A: fills the input, images included, and does not send.
await exec('workbench.action.chat.open', {
  query: 'Check A',
  isPartialQuery: true,
  attachFiles: [file, image, { uri: file, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 } }],
});
await sleep(2500);
let dom = await inputs();
check('A: text is in the input', hasText(dom, 'Check A'));
const labels = dom.flatMap(input => input.attachments).join(' | ');
check('A: file attached', labels.includes('Attached file, sample.ts'), labels);
check('A: line range attached', labels.includes('line 1 to line 2'));
check('A: image attached as an image', labels.includes('Attached image, shot.png'));

// A second partial query replaces the text and keeps the attachments.
await exec('workbench.action.chat.open', { query: 'Check A again', isPartialQuery: true });
await sleep(1200);
dom = await inputs();
check('A: partial query replaces the text', dom.some(input => input.text.trim() === 'Check A again'));
check('A: attachments stay', dom.flatMap(input => input.attachments).length === 3);

// C: a new chat, then restore.
await exec('workbench.action.chat.newChat');
await exec('workbench.action.chat.open', { query: 'Check C', isPartialQuery: true, attachFiles: [image] });
await sleep(1500);
dom = await inputs();
check('C: lands in the new chat', hasText(dom, 'Check C'));
check('C: only the new attachment', dom.flatMap(input => input.attachments).length === 1);

// D: the document is readable, and which input has focus is not known.
const state = await api('/state');
const documents = state.docs.filter(doc => doc.scheme === 'chatSessionInput');
check('D: chat input document is visible', documents.some(doc => doc.text.includes('Check C')));
check('D: image placeholder is in its text', documents.some(doc => doc.text.includes('\uFFFC')));
const box = JSON.parse(await page.evaluate(`JSON.stringify((() => { const r = document.querySelector('.interactive-input-part .monaco-editor').getBoundingClientRect(); return { x: r.x + 20, y: r.y + 8 }; })())`));
await page.click(box.x, box.y);
await sleep(400);
const focused = await api('/state');
check('D: activeTextEditor is NOT the focused input (the known limit)', !focused.active || focused.active.scheme !== 'chatSessionInput', JSON.stringify(focused.active ?? null));

// E: the button renders, and a real click does not reach the extension.
const before = (await api('/state')).parked;
const button = JSON.parse(await page.evaluate(`JSON.stringify((() => { const e = document.querySelector('.chat-input-status-toolbar [aria-label="Park"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())`));
check('E: button renders', Boolean(button));
if (button) {
  await page.evaluate(`window.__errors = []; (() => { const original = JSON.stringify; JSON.stringify = function (...args) { try { return original.apply(this, args); } catch (error) { window.__errors.push(String(error.message).split('\\n')[0]); throw error; } }; })()`);
  await page.click(button.x, button.y);
  await sleep(800);
  const after = (await api('/state')).parked;
  const errors = await page.evaluate('window.__errors.join()');
  console.log(`INFO  E: click ${after > before ? 'reached the extension: the bug may be fixed, so try turning the button on' : `did not reach the extension (${errors})`}`);
}

page.close();
finish();
