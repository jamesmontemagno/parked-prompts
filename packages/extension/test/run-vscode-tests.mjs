// Runs test/suite inside real VS Code. Set VSCODE_EXECUTABLE to use an installed
// build; otherwise the latest Insiders is downloaded. On Linux, run under xvfb-run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, '..');
const out = join(extensionDevelopmentPath, 'dist', 'test');

await build({
  entryPoints: [join(here, 'suite/index.ts')],
  outfile: join(out, 'index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  external: ['vscode', 'mocha'],
  sourcemap: true,
  logLevel: 'warning',
});

const scratch = mkdtempSync(join(tmpdir(), 'parked-vscode-'));
const workspace = join(scratch, 'workspace');
mkdirSync(join(workspace, '.git'), { recursive: true });
mkdirSync(join(workspace, 'src'));
writeFileSync(join(workspace, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/test/workspace.git\n');
writeFileSync(join(workspace, 'src', 'a.ts'), 'export const a = 1;\n');

const userData = join(scratch, 'user-data');
mkdirSync(join(userData, 'User'), { recursive: true });
writeFileSync(join(userData, 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false }));

const launchArgs = [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${join(scratch, 'extensions')}`, '--skip-welcome', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
if (process.getuid?.() === 0) launchArgs.push('--no-sandbox');

let failed = false;
try {
  await runTests({
    ...(process.env.VSCODE_EXECUTABLE ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE } : { version: process.env.VSCODE_VERSION ?? 'insiders' }),
    extensionDevelopmentPath,
    extensionTestsPath: join(out, 'index.cjs'),
    launchArgs,
    extensionTestsEnv: { PARKED_PROMPTS_HOME: join(scratch, 'home'), PARKED_TEST_WORKSPACE: workspace },
  });
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
