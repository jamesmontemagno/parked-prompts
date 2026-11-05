import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { slugify } from '@parked-prompts/core';

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = (args, cwd) =>
  new Promise((done, fail) => {
    execFile('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) fail(new Error(stderr.trim() || error.message));
      else done(stdout.trim());
    });
  });

export interface WorktreePlan {
  branch: string;
  path: string;
}

/** Sensible defaults: `parked/<slug>` in a folder beside the checkout, not inside it. */
export function defaultWorktreePlan(title: string, id: string, repoRoot: string): WorktreePlan {
  const slug = slugify(title);
  const suffix = id.slice(-6);
  const name = `${slug}-${suffix}`;
  return { branch: `parked/${name}`, path: join(dirname(repoRoot), `${basename(repoRoot)}-worktrees`, name) };
}

export async function validateBranchName(git: GitRunner, repoRoot: string, branch: string): Promise<string | undefined> {
  const value = branch.trim();
  if (!value) return 'Enter a branch name.';
  // Refused here as well as by Git, because a leading dash would be read as an option.
  if (value.startsWith('-')) return 'A branch name cannot start with a dash.';
  try {
    await git(['check-ref-format', '--branch', value], repoRoot);
    return undefined;
  } catch {
    return `"${value}" is not a valid branch name.`;
  }
}

export async function validateWorktreePath(path: string): Promise<string | undefined> {
  const value = path.trim();
  if (!value) return 'Enter a folder.';
  if (!isAbsolute(value)) return 'Enter a full path.';
  const taken = await access(value).then(() => true, () => false);
  return taken ? 'That folder already exists. Choose a new one.' : undefined;
}

const branchExists = (git: GitRunner, repoRoot: string, branch: string) =>
  git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot).then(() => true, () => false);

/** Creates the worktree, on a new branch or an existing one. Nothing ever deletes one. */
export async function createWorktree(git: GitRunner, repoRoot: string, plan: WorktreePlan): Promise<string> {
  const path = resolve(plan.path);
  const args = (await branchExists(git, repoRoot, plan.branch))
    ? ['worktree', 'add', path, plan.branch]
    : ['worktree', 'add', '-b', plan.branch, path];
  await git(args, repoRoot);
  return path;
}
