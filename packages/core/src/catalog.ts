import { matchRepo, type RepoInfo, type RepoMatch } from './git.ts';
import { defaultHome, repoStoreRoot } from './paths.ts';
import { PromptStore, type StoreOptions } from './store.ts';
import { TrustStore } from './trust.ts';
import type { ParkedPrompt, PromptRef, StoreKind, StoreProblem } from './types.ts';

export type PromptScope = 'repo' | 'all';

export interface CatalogOptions extends StoreOptions {
  home?: string;
  repo?: RepoInfo;
  /** False in an untrusted workspace: prompts that arrived by Git are not even listed. */
  allowRepoStore?: boolean;
}

export interface CatalogEntry extends ParkedPrompt {
  match: RepoMatch;
}

/** The global store and, when a repository is open and allowed, its repo store. */
export class PromptCatalog {
  readonly home: string;
  readonly repo: RepoInfo | undefined;
  readonly global: PromptStore;
  readonly repoStore: PromptStore | undefined;
  readonly trust: TrustStore;

  constructor(options: CatalogOptions = {}) {
    const { home = defaultHome(), repo, allowRepoStore = true, ...store } = options;
    this.home = home;
    this.repo = repo;
    this.global = new PromptStore(home, 'global', store);
    this.repoStore = repo && allowRepoStore ? new PromptStore(repoStoreRoot(repo.root), 'repo', store) : undefined;
    this.trust = new TrustStore(home);
  }

  storeFor(kind: StoreKind): PromptStore {
    if (kind === 'global') return this.global;
    if (!this.repoStore) throw new Error('The repo store is not available here.');
    return this.repoStore;
  }

  get(ref: PromptRef): Promise<ParkedPrompt> {
    return this.storeFor(ref.store).get(ref.id);
  }

  /**
   * `repo` shows prompts for the open repository, or those with no repository when
   * none is open. `all` reads across every repository in the global store.
   */
  async list(scope: PromptScope = 'repo'): Promise<{ prompts: CatalogEntry[]; problems: StoreProblem[] }> {
    const [global, repoEntries] = await Promise.all([this.global.list(), this.repoStore?.list()]);
    const toEntry = (prompt: ParkedPrompt): CatalogEntry => ({
      ...prompt,
      match: prompt.store === 'repo' ? 'path' : matchRepo(prompt.repo, this.repo),
    });
    const entries = [...global.prompts, ...(repoEntries?.prompts ?? [])].map(toEntry);
    const prompts = entries
      .filter(entry => {
        if (scope === 'all' || entry.store === 'repo') return true;
        return this.repo ? entry.match !== 'none' : !entry.repo;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    return { prompts, problems: [...global.problems, ...(repoEntries?.problems ?? [])] };
  }
}

/** The checkout whose files a prompt's workspace references should resolve against. */
export const workspaceRootFor = (prompt: ParkedPrompt, repo: RepoInfo | undefined): string | undefined =>
  prompt.store === 'repo' || matchRepo(prompt.repo, repo) !== 'none' ? repo?.root : undefined;
