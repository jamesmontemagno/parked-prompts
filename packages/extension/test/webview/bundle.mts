import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Bundle the actual sidebar without writing generated files into the workspace. */
export async function bundleWebview(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../src/webview/main.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('The sidebar bundle was not generated.');
  return output.text;
}
