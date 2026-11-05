// Serves site/ under /parked-prompts/, the path GitHub Pages uses, so links behave the same.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'site');
const BASE = '/parked-prompts/';
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  if (path === '/') {
    response.writeHead(302, { Location: BASE }).end();
    return;
  }
  const relative = path.startsWith(BASE) ? path.slice(BASE.length) : null;
  let file = relative === null ? null : join(ROOT, relative);
  if (file && !file.startsWith(ROOT)) file = null;
  if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  const found = file && existsSync(file);
  const served = found ? file : join(ROOT, '404.html');
  response.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[extname(served)] ?? 'application/octet-stream' });
  createReadStream(served).pipe(response);
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}${BASE}`));
