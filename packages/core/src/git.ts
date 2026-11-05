import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { remoteLabel, normalizeRemote } from './remote.ts';
import type { PromptRepo } from './types.ts';

const MAX_CONFIG_BYTES = 1024 * 1024;

export interface RepoInfo {
  /** The checkout's root folder. */
  root: string;
  /** Normalized remote of `origin`, or of the first remote. */
  remote?: string;
  /** True for a linked worktree. */
  isWorktree: boolean;
  /** A short name to show. */
  label: string;
}

/** Reads the remotes from a Git config file. Later values for one remote replace earlier ones. */
export function parseGitRemotes(config: string): Map<string, string> {
  const remotes = new Map<string, string>();
  let current: string | undefined;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      current = /^\[\s*remote\s+"((?:[^"\\]|\\.)*)"\s*\]/i.exec(line)?.[1];
      continue;
    }
    if (current === undefined) continue;
    const match = /^url\s*=\s*(.*)$/i.exec(line);
    if (match) remotes.set(current, (match[1] ?? '').replace(/^"(.*)"$/, '$1'));
  }
  return remotes;
}

const readSmall = async (path: string): Promise<string | undefined> => {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_CONFIG_BYTES) return undefined;
  return readFile(path, 'utf8').catch(() => undefined);
};

/**
 * Finds the repository holding a folder and its remote by reading the files. Git
 * itself is not run: a repository's config can make it run commands, and a prompt
 * list must be safe to show in a checkout nobody has trusted yet.
 */
export async function readRepoInfo(startDir: string): Promise<RepoInfo | undefined> {
  let dir = resolve(startDir);
  for (;;) {
    const dotGit = resolve(dir, '.git');
    const info = await stat(dotGit).catch(() => undefined);
    if (info) {
      let commonDir = dotGit;
      let isWorktree = false;
      if (info.isFile()) {
        const pointer = /^gitdir:\s*(.+?)\s*$/m.exec((await readSmall(dotGit)) ?? '')?.[1];
        if (!pointer) return undefined;
        const gitDir = resolve(dir, pointer);
        const common = (await readSmall(resolve(gitDir, 'commondir')))?.trim();
        commonDir = common ? resolve(gitDir, common) : gitDir;
        isWorktree = common !== undefined;
      }
      const remotes = parseGitRemotes((await readSmall(resolve(commonDir, 'config'))) ?? '');
      const url = remotes.get('origin') ?? [...remotes.values()][0];
      const remote = url ? normalizeRemote(url) : undefined;
      return { root: dir, ...(remote && { remote }), isWorktree, label: remote ? remoteLabel(remote) : basename(dir) };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export type RepoMatch = 'remote' | 'path' | 'none';

const samePath = (a: string, b: string) => {
  const [left, right] = [resolve(a), resolve(b)];
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};

/** Matches by remote first, so a prompt follows re-clones and worktrees, then by path. */
export function matchRepo(promptRepo: PromptRepo | undefined, current: Pick<RepoInfo, 'root' | 'remote'> | undefined): RepoMatch {
  if (!promptRepo || !current) return 'none';
  if (promptRepo.remote && current.remote && promptRepo.remote === current.remote) return 'remote';
  if (promptRepo.path && samePath(promptRepo.path, current.root)) return 'path';
  return 'none';
}

/** What a new prompt records about where it was parked. */
export const promptRepoFrom = (repo: RepoInfo | undefined): PromptRepo | undefined =>
  repo ? { ...(repo.remote && { remote: repo.remote }), path: repo.root } : undefined;
