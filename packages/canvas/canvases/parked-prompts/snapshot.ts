import { resolve } from 'node:path'
import {
  attachmentLabel,
  defaultHome,
  excerpt,
  isImageFile,
  matchRepo,
  PromptCatalog,
  readRepoInfo,
  remoteLabel,
  resolveAttachments,
  workspaceRootFor,
  type ParkedPrompt,
  type PromptRef,
  type RepoInfo,
} from '@parked-prompts/core'
import { basename } from 'node:path'
import type { CanvasState, PromptSummary } from './shared.ts'

export type RepoState = CanvasState['repo']

/** The repository the canvas belongs to: the agent's working folder unless it names another. */
export async function findRepo(requestedPath: string | undefined): Promise<RepoState> {
  const folder = resolve(requestedPath ?? process.cwd())
  const repo = await readRepoInfo(folder)
  if (repo) return { root: repo.root, ...(repo.remote && { remote: repo.remote }), label: repo.label, isGit: true }
  return { root: folder, label: basename(folder), isGit: false }
}

const repoInfoOf = (repo: RepoState): RepoInfo | undefined =>
  repo ? { root: repo.root, ...(repo.remote && { remote: repo.remote }), isWorktree: false, label: repo.label } : undefined

export const catalogFor = (repo: RepoState): PromptCatalog => {
  const info = repoInfoOf(repo)
  return new PromptCatalog({ home: defaultHome(), ...(info && { repo: info }), allowRepoStore: Boolean(repo?.isGit) })
}

/** The host only accepts IDs made of `[A-Za-z0-9_.:-]`, so this uses the attachment's position, not its name. */
export const fileIdFor = (prompt: Pick<ParkedPrompt, 'store' | 'id'>, index: number): string => `${prompt.store}:${prompt.id}:${index}`

export const attachmentsOf = (prompt: ParkedPrompt, repo: RepoState) => resolveAttachments(prompt, workspaceRootFor(prompt, repoInfoOf(repo)))

export async function summarize(prompt: ParkedPrompt, catalog: PromptCatalog, repo: RepoState): Promise<PromptSummary> {
  const { resolved, missing } = await attachmentsOf(prompt, repo)
  const repoLabel = prompt.repo?.remote ? remoteLabel(prompt.repo.remote) : prompt.repo?.path ? basename(prompt.repo.path) : undefined
  return {
    id: prompt.id,
    store: prompt.store,
    title: prompt.title,
    excerpt: excerpt(prompt.body),
    status: prompt.status,
    updatedAt: prompt.updatedAt,
    ...(repoLabel && { repoLabel }),
    ...(prompt.mode && { mode: prompt.mode }),
    needsConfirmation: await catalog.trust.needsConfirmation(prompt),
    inCurrentRepo: prompt.store === 'repo' || matchRepo(prompt.repo, repoInfoOf(repo)) !== 'none',
    attachments: prompt.attachments.map((attachment, index) => {
      const found = resolved.find(item => item.attachment === attachment)
      const absent = missing.find(item => item.attachment === attachment)
      return {
        path: attachment.path,
        label: attachmentLabel(attachment),
        kind: attachment.kind,
        ...(attachment.kind === 'workspace' && attachment.range && { startLine: attachment.range.startLine, endLine: attachment.range.endLine }),
        ...(found && attachment.kind === 'copy' && isImageFile(found.absolutePath) && { fileId: fileIdFor(prompt, index) }),
        ...(absent && { missing: absent.reason }),
      }
    }),
    warnings: prompt.warnings,
  }
}

export interface Snapshot {
  prompts: PromptSummary[]
  problems: { id: string; reason: string }[]
}

/** Reads the store, which is the source of truth; the canvas state only mirrors it. */
export async function readSnapshot(repo: RepoState, scope: CanvasState['scope']): Promise<Snapshot> {
  const catalog = catalogFor(repo)
  const { prompts, problems } = await catalog.list(scope)
  return {
    prompts: await Promise.all(prompts.map(prompt => summarize(prompt, catalog, repo))),
    problems: problems.map(problem => ({ id: problem.id, reason: problem.reason })),
  }
}

export const getPrompt = (repo: RepoState, ref: PromptRef): Promise<ParkedPrompt> => catalogFor(repo).get(ref)
