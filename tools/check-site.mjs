// Checks the website without a browser: links, anchors, page basics, the security
// policy, and that the docs still match the extension's real commands and settings.
// Usage: node tools/check-site.mjs [site folder]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const SITE = resolve(process.argv[2] ?? join(REPO, 'site'));
const SITE_URL = 'https://jamesmontemagno.github.io/parked-prompts/';
const MAX_BYTES = 3 * 1024 * 1024;
const problems = [];

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = walk(SITE);
const pages = files.filter(file => file.endsWith('.html'));
const nameOf = file => relative(SITE, file).split(sep).join('/');
const sources = new Map(pages.map(file => [file, readFileSync(file, 'utf8')]));
const idsOf = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
const report = (page, message) => problems.push(`${page ? `${nameOf(page)}: ` : ''}${message}`);

function resolveTarget(page, html, url) {
  const [path, hash] = url.split('#');
  const base = html.includes('<base href="/parked-prompts/">') ? SITE : dirname(page);
  let target = path === '/parked-prompts/' ? SITE : path ? resolve(base, path) : page;
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  return { target, hash };
}

for (const [page, html] of sources) {
  for (const [label, pattern] of [
    ['a language', /<html lang="en">/],
    ['a title', /<title>[^<]+<\/title>/],
    ['a description', /<meta name="description" content="[^"]+">/],
    ['a viewport', /<meta name="viewport"/],
    ['a Content-Security-Policy', /http-equiv="Content-Security-Policy" content="default-src 'none'/],
  ]) if (!pattern.test(html)) report(page, `has no ${label}.`);

  const headings = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (headings !== 1) report(page, `has ${headings} h1 headings, not 1.`);
  if (/\sstyle="/.test(html)) report(page, 'has an inline style, which its security policy blocks.');
  if (/\son[a-z]+="/.test(html)) report(page, 'has an inline event handler, which its security policy blocks.');
  for (const [, attributes] of html.matchAll(/<script\b([^>]*)>/g)) {
    if (!/\ssrc="/.test(attributes)) report(page, 'has an inline script, which its security policy blocks.');
    else if (/src="https?:/.test(attributes)) report(page, 'loads a script from another site.');
  }
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(tag)) report(page, `has an image with no alt text: ${tag.slice(0, 70)}`);
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) report(page, `has an image with no size, which makes the page jump: ${tag.slice(0, 70)}`);
  }
  if (!nameOf(page).startsWith('404') && !html.includes(`<link rel="canonical" href="${SITE_URL}`)) report(page, 'has no canonical link.');

  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (/^(?:https?:|mailto:)/.test(url)) continue;
    const { target, hash } = resolveTarget(page, html, url);
    if (!existsSync(target)) {
      report(page, `links to ${url}, which does not exist.`);
      continue;
    }
    if (hash && !idsOf(sources.get(target) ?? '').has(hash)) report(page, `links to ${url}, but that anchor does not exist.`);
  }
  // A tab must point at a real panel.
  for (const [, id] of html.matchAll(/aria-controls="([^"]+)"/g)) if (!idsOf(html).has(id)) report(page, `has a tab for #${id}, which does not exist.`);
}

// The sitemap and the pages agree.
const listed = [...readFileSync(join(SITE, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
for (const page of pages) {
  if (nameOf(page).startsWith('404')) continue;
  const url = SITE_URL + nameOf(page).replace(/index\.html$/, '');
  if (!listed.includes(url)) report(null, `sitemap.xml is missing ${url}.`);
}
for (const url of listed) {
  if (!existsSync(join(SITE, url.slice(SITE_URL.length), 'index.html'))) report(null, `sitemap.xml lists ${url}, which does not exist.`);
}

// The docs describe what the extension really has.
const manifest = JSON.parse(readFileSync(join(REPO, 'packages/extension/package.json'), 'utf8'));
const docsPage = join(SITE, 'docs', 'index.html');
const docs = sources.get(docsPage) ?? '';
for (const { title } of manifest.contributes.commands) if (!docs.includes(`<td>${title}</td>`)) report(docsPage, `does not list the command "${title}".`);
for (const key of Object.keys(manifest.contributes.configuration.properties)) if (!docs.includes(`<code>${key}</code>`)) report(docsPage, `does not list the setting ${key}.`);
for (const [, code] of docs.matchAll(/<code>(parkedPrompts\.[\w.]+)<\/code>/g)) if (!(code in manifest.contributes.configuration.properties)) report(docsPage, `mentions a setting that does not exist: ${code}.`);
const extensionId = `${manifest.publisher}.${manifest.name}`;
for (const [page, html] of sources) {
  for (const [, id] of html.matchAll(/(?:install-extension |itemName=)([\w.-]+)/g)) if (id !== extensionId) report(page, `installs ${id}, but the extension is ${extensionId}.`);
}
const engine = manifest.engines.vscode.replace(/^\^/, '').split('.').slice(0, 2).join('.');
if (!docs.includes(`VS Code ${engine} or later`)) report(docsPage, `does not say it needs VS Code ${engine}.`);

// The budget, and a licence for what is bundled.
const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
if (bytes > MAX_BYTES) report(null, `The site is ${bytes} bytes, over the ${MAX_BYTES} byte budget.`);
if (files.some(file => file.endsWith('.woff2')) && !existsSync(join(SITE, 'assets/fonts/LICENSE.txt'))) report(null, 'The fonts have no license file.');

for (const problem of problems) console.error(`FAIL  ${problem}`);
if (problems.length > 0) process.exit(1);
console.log(`OK  ${pages.length} pages, ${files.length} files, ${Math.round(bytes / 1024)} KB`);
