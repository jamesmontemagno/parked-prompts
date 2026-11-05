import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { versionForCanvasRelease } from './prepare-canvas-release.mjs';

test('chooses a version from the last publication and the changes', () => {
  assert.equal(versionForCanvasRelease('0.1.0', null, false), '0.1.0');
  assert.equal(versionForCanvasRelease('0.1.0', { version: '0.1.9', canvasChanged: false }, false), '0.1.9');
  assert.equal(versionForCanvasRelease('0.1.0', { version: '0.1.9', canvasChanged: true }, false), '0.1.10');
  assert.equal(versionForCanvasRelease('0.1.0', { version: '0.1.9', canvasChanged: false }, true), '0.1.10');
  assert.throws(() => versionForCanvasRelease('0.1.0', { version: '0.1.0-beta' }, false), /stable three-part canvas version/);
});

test('stamps canvas changes and changed output through aliased paths, but not an unchanged build', () => {
  const temp = mkdtempSync(join(tmpdir(), 'canvas-release-test-'));
  const root = join(temp, 'repo');
  const alias = join(temp, 'repo-alias');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, content) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const commit = message => git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message);
  const builtManifest = 'packages/canvas/dist/marketplace/plugins/parked-prompts/.plugin/plugin.json';
  const manifest = '{"name":"parked-prompts","version":"0.1.9"}\n';
  const run = (mode, worktree = alias) => {
    const result = spawnSync(process.execPath, [join(worktree, 'tools/prepare-canvas-release.mjs'), mode], {
      cwd: join(worktree, 'packages/canvas'), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(join(worktree, 'packages/canvas/package.json'), 'utf8')).version;
  };

  try {
    mkdirSync(root);
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    git('init', '-b', 'main');
    write('.gitignore', 'packages/canvas/dist/\n');
    write('packages/canvas/package.json', '{"version":"0.1.0"}\n');
    mkdirSync(join(root, 'tools'), { recursive: true });
    copyFileSync(fileURLToPath(new URL('./prepare-canvas-release.mjs', import.meta.url)), join(root, 'tools/prepare-canvas-release.mjs'));
    git('add', '--all');
    commit('Source');
    const sourceCommit = git('rev-parse', 'HEAD');

    git('switch', '--orphan', 'published');
    write('plugins/parked-prompts/.plugin/plugin.json', manifest);
    write('plugins/parked-prompts/release.json', JSON.stringify({ version: '0.1.9', sourceCommit }));
    git('add', '--all');
    commit('Published');
    git('update-ref', 'refs/remotes/origin/stable', 'HEAD');
    git('switch', 'main');

    write(builtManifest, manifest);
    assert.equal(run('--baseline'), '0.1.9');
    assert.equal(run('--stamp'), '0.1.9');

    write('packages/core/src/store.ts', 'changed\n');
    git('add', 'packages/core/src/store.ts');
    commit('Core change');
    git('worktree', 'add', '--detach', 'linked-source', 'HEAD');
    const linked = join(alias, 'linked-source');
    write(join('linked-source', builtManifest), '{"name":"parked-prompts","version":"0.1.9","changed":true}\n');
    assert.equal(run('--baseline', linked), '0.1.9');
    assert.equal(run('--stamp', linked), '0.1.10');

    assert.equal(run('--baseline'), '0.1.9');
    write(builtManifest, manifest);
    write('packages/canvas/canvases/caf\u00e9.tsx', 'changed\n');
    git('add', 'packages/canvas/canvases/caf\u00e9.tsx');
    commit('Canvas change');
    assert.equal(run('--stamp'), '0.1.10');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
