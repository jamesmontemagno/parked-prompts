import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(root, 'packages/canvas/package.json');
const marketplacePath = join(root, 'packages/canvas/dist/marketplace');
const releasePath = 'plugins/parked-prompts/release.json';

function runGit(args, { allowStatusOne = false, cwd = root, env = process.env } = {}) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !(allowStatusOne && result.status === 1)) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result;
}

function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error(`Expected a stable three-part canvas version, got "${version}".`);
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Canvas version is too large: "${version}".`);
  return parts;
}

function incrementPatch(version) {
  const [major, minor, patch] = parseVersion(version);
  if (!Number.isSafeInteger(patch + 1)) throw new Error(`Canvas version patch is too large: "${version}".`);
  return `${major}.${minor}.${patch + 1}`;
}

export function versionForCanvasRelease(defaultVersion, previousRelease, outputChanged) {
  if (!previousRelease) {
    parseVersion(defaultVersion);
    return defaultVersion;
  }

  parseVersion(previousRelease.version);
  return previousRelease.canvasChanged || outputChanged
    ? incrementPatch(previousRelease.version)
    : previousRelease.version;
}

function readPreviousRelease() {
  const stable = runGit(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/stable'], { allowStatusOne: true });
  if (stable.status === 1) return null;

  const release = JSON.parse(runGit(['show', `origin/stable:${releasePath}`]).stdout);
  if (typeof release.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(release.sourceCommit)) {
    throw new Error(`The published canvas release stamp has an invalid sourceCommit.`);
  }
  runGit(['merge-base', '--is-ancestor', release.sourceCommit, 'HEAD']);

  const canvasChanged = runGit([
    'diff',
    '--quiet',
    `${release.sourceCommit}..HEAD`,
    '--',
    'packages/canvas/',
  ], { allowStatusOne: true }).status === 1;

  return { version: release.version, canvasChanged };
}

function generatedMarketplaceChanged() {
  const temp = mkdtempSync(join(tmpdir(), 'canvas-release-index-'));
  try {
    const gitDir = runGit(['rev-parse', '--absolute-git-dir']).stdout.trim();
    const env = {
      ...process.env,
      GIT_DIR: gitDir,
      GIT_WORK_TREE: marketplacePath,
      GIT_INDEX_FILE: join(temp, 'index'),
    };
    const options = { cwd: marketplacePath, env };
    runGit(['read-tree', 'origin/stable'], options);
    runGit(['add', '--all', '--force', '--', '.'], options);
    return runGit([
      'diff', '--cached', '--quiet', 'origin/stable', '--', '.', `:(exclude)${releasePath}`,
    ], { ...options, allowStatusOne: true }).status === 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function prepareCanvasRelease(mode) {
  if (mode !== '--baseline' && mode !== '--stamp') {
    throw new Error('Expected --baseline or --stamp.');
  }
  const canvasPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  const previous = readPreviousRelease();
  const outputChanged = mode === '--stamp' && previous && !previous.canvasChanged && generatedMarketplaceChanged();
  const version = mode === '--baseline'
    ? previous?.version ?? canvasPackage.version
    : versionForCanvasRelease(canvasPackage.version, previous, outputChanged);
  parseVersion(version);
  if (canvasPackage.version !== version) {
    canvasPackage.version = version;
    writeFileSync(packagePath, `${JSON.stringify(canvasPackage, null, 2)}\n`);
  }

  console.log(`${mode === '--baseline' ? 'Baseline' : 'Final'} canvas version: ${version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareCanvasRelease(process.argv[2]);
}
