const vscode = require('vscode'), http = require('http'), fs = require('fs'), path = require('path');
let port=9444;
const revive = v => {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') { if (v.$file) return vscode.Uri.file(v.$file); const o = {}; for (const k in v) o[k] = revive(v[k]); return o; }
  return v;
};
exports.activate = ctx => {
  let parked = 0;
  ctx.subscriptions.push(vscode.commands.registerCommand('spike.park', () => { parked++; }));
  const docs = () => vscode.workspace.textDocuments.map(d => ({ uri: d.uri.toString(), scheme: d.uri.scheme, text: d.getText().slice(0, 200) }));
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const send = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    try {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/exec') {
        const { command, args = [] } = JSON.parse(body);
        const started = Date.now();
        const result = await vscode.commands.executeCommand(command, ...revive(args));
        return send({ ok: true, ms: Date.now() - started, result: result === undefined ? null : String(result).slice(0, 200) });
      }
      if (u.pathname === '/state') {
        const ae = vscode.window.activeTextEditor;
        return send({ parked, active: ae && { uri: ae.document.uri.toString(), scheme: ae.document.uri.scheme, text: ae.document.getText().slice(0, 200) }, docs: docs(), visible: vscode.window.visibleTextEditors.map(e => e.document.uri.toString()), appName: vscode.env.appName, wf: (vscode.workspace.workspaceFolders || []).map(f => f.uri.toString()) });
      }
      if (u.pathname === '/commands') { const all = await vscode.commands.getCommands(true); return send(all.filter(c => new RegExp(u.searchParams.get('q') || '.').test(c))); }
      res.statusCode = 404; res.end();
    } catch (e) { send({ ok: false, error: String(e && e.message || e) }); }
  });
  const tryListen=()=>{server.once('error',()=>{port++;if(port<9460)tryListen();});server.listen(port,'127.0.0.1',()=>{});};tryListen();
  ctx.subscriptions.push({ dispose: () => server.close() });
};
