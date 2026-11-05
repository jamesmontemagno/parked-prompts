import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readRepoInfo } from '@parked-prompts/core';
import { createWorktree, defaultWorktreePlan, runGit, validateBranchName, validateWorktreePath } from '../../src/worktree.ts';

const scratch = mkdtempSync(join(tmpdir(), 'parked-worktree-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function makeRepo(name: string): string {
  const root = join(scratch, name);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('remote', 'add', 'origin', 'git@github.com:Owner/Repo.git');
  writeFileSync(join(root, 'a.txt'), 'hello');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return root;
}

describe('worktree plan', () => {
  it('suggests a branch and a folder beside the checkout', () => {
    expect(defaultWorktreePlan('Fix the Login!', '20261105-160520-a1b2c3', '/work/app')).toEqual({
      branch: 'parked/fix-the-login-a1b2c3',
      path: join('/work', 'app-worktrees', 'fix-the-login-a1b2c3'),
    });
  });
});

describe('validation', () => {
  const root = makeRepo('validate');

  it('accepts good branch names and refuses bad ones', async () => {
    expect(await validateBranchName(runGit, root, 'parked/fix-1')).toBeUndefined();
    for (const bad of ['', '   ', 'has space', 'a..b', '-rf', '--force', 'x~1', 'end.lock']) {
      expect(await validateBranchName(runGit, root, bad), bad).toBeTypeOf('string');
    }
  });

  it('wants a new folder given by its full path', async () => {
    expect(await validateWorktreePath(join(scratch, 'not-yet'))).toBeUndefined();
    expect(await validateWorktreePath(root)).toContain('already exists');
    expect(await validateWorktreePath('relative/path')).toContain('full path');
    expect(await validateWorktreePath('')).toBe('Enter a folder.');
  });
});

describe('createWorktree', () => {
  it('creates a real worktree on a new branch, leaving the checkout alone', async () => {
    const root = makeRepo('create');
    const path = join(scratch, 'create-wt', 'one');
    const created = await createWorktree(runGit, root, { branch: 'parked/one', path });
    expect(created).toBe(path);
    expect(existsSync(join(path, 'a.txt'))).toBe(true);
    expect(await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root)).toBe('main');
    expect(await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('parked/one');
    expect(await readRepoInfo(path)).toMatchObject({ remote: 'github.com/owner/repo', isWorktree: true, root: path });
    expect(dirname(path)).toBe(join(scratch, 'create-wt'));
  });

  it('checks out a branch that already exists', async () => {
    const root = makeRepo('existing');
    await runGit(['branch', 'parked/already'], root);
    const path = join(scratch, 'existing-wt');
    await createWorktree(runGit, root, { branch: 'parked/already', path });
    expect(await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('parked/already');
  });

  it('reports a Git failure', async () => {
    const root = makeRepo('fail');
    const path = join(scratch, 'fail-wt');
    await createWorktree(runGit, root, { branch: 'parked/x', path });
    await expect(createWorktree(runGit, root, { branch: 'parked/x', path: join(scratch, 'fail-wt-2') })).rejects.toThrow(/already/);
  });
});
