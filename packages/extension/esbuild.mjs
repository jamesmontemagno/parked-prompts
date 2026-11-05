import { copyFile, mkdir } from 'node:fs/promises';
import { build, context } from 'esbuild';

const shared = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022', legalComments: 'none' };

const configs = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    // Core is ESM; `import.meta` is not used, so CommonJS output is safe.
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

if (process.argv.includes('--watch')) {
  for (const config of configs) await (await context(config)).watch();
} else {
  await Promise.all(configs.map(config => build(config)));
}
