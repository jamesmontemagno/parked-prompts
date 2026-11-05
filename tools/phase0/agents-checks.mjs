// Checks B and I in the Agents window. Start VS Code with ./launch.sh --agents first.
import { api, check, exec, finish, sleep, target } from './lib.mjs';

const WS = `${process.env.PHASE0_DIR ?? '/tmp/phase0'}/ws`;
const page = await target('sessions.html');
const composer = async () => JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll('.monaco-editor')].filter(e => e.offsetParent !== null).map(e => e.querySelector('.view-lines')?.innerText?.replace(/\\u00a0/g, ' ')).filter(Boolean))`));

// I: this extension answering at all shows capabilities.agentsWindow.supported is enough.
const state = await api('/state');
check('I: the extension runs here with no setting', Array.isArray(state.docs));

const commands = await api(`/commands?q=${encodeURIComponent('^workbench\\.action\\.(chat\\.open|sessions\\.newChat)$')}`);
check('B: sessions.newChat exists here', commands.includes('workbench.action.sessions.newChat'));
check('B: chat.open is registered', commands.includes('workbench.action.chat.open'));

await exec('workbench.action.chat.open', { query: 'Check B chat.open', isPartialQuery: true, attachFiles: [{ $file: `${WS}/shot.png` }] });
await sleep(2500);
console.log(`INFO  B: chat.open ${(await composer()).join().includes('Check B chat.open') ? 'WORKS here now: the restore path can be simplified' : 'does nothing here (the known limit)'}`);

await exec('workbench.action.sessions.newChat', { prompt: 'Check B prefill', prefillPrompt: true });
await sleep(2500);
check('B: prefillPrompt fills the composer', (await composer()).join().includes('Check B prefill'));

const documents = (await api('/state')).docs.filter(doc => doc.scheme === 'chatSessionInput' || doc.scheme === 'sessions-chat');
check('D: the composer document is readable', documents.some(doc => doc.text.includes('Check B prefill')));

page.close();
finish();
