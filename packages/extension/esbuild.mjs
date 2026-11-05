import { copyFile, mkdir } from 'node:fs/promises';
import { build, context } from 'esbuild';

const watching = process.argv.includes('--watch');
// Published builds are minified, and keep their source maps outside the package.
const shared = { bundle: true, sourcemap: watching ? 'linked' : 'external', minify: !watching, logLevel: 'info', target: 'es2022', legalComments: 'none' };

const configs = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  },
  {
    ...shared,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
  },
];

await mkdir('dist', { recursive: true });
await copyFile('src/webview/webview.css', 'dist/webview.css');

if (watching) {
  for (const config of configs) await (await context(config)).watch();
} else {
  await Promise.all(configs.map(config => build(config)));
}
