import { z } from '@rwoll/canvas-kit'

// Shared by canvas.ts and its UI, so this file imports nothing from Node.js.

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/

export const promptRef = z.object({ store: z.enum(['global', 'repo']), id: z.string().regex(ID) })
export type PromptRefInput = z.infer<typeof promptRef>

export const attachmentView = z.object({
  path: z.string(),
  label: z.string(),
  kind: z.enum(['copy', 'workspace']),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  /** Asks the canvas for this image. Only set on images it can show. */
  fileId: z.string().optional(),
  missing: z.enum(['no-workspace', 'not-found', 'blocked']).optional(),
})

export const promptSummary = z.object({
  id: z.string(),
  store: z.enum(['global', 'repo']),
  title: z.string(),
  excerpt: z.string(),
  status: z.enum(['draft', 'parked', 'done']),
  updatedAt: z.string(),
  repoLabel: z.string().optional(),
  mode: z.string().optional(),
  model: z.string().optional(),
  needsConfirmation: z.boolean(),
  inCurrentRepo: z.boolean(),
  attachments: z.array(attachmentView),
  warnings: z.array(z.string()),
})
export type PromptSummary = z.infer<typeof promptSummary>

export const armedPrompt = z.object({ store: z.enum(['global', 'repo']), id: z.string(), title: z.string(), armedAt: z.number() })

export const canvasState = z.object({
  repo: z.object({ root: z.string(), remote: z.string().optional(), label: z.string(), isGit: z.boolean() }).nullable(),
  scope: z.enum(['repo', 'all']),
  prompts: z.array(promptSummary),
  problems: z.array(z.object({ id: z.string(), reason: z.string() })),
  armed: z.array(armedPrompt),
  /** When this canvas last sent a prompt, so one send waits for the agent to finish before the next. */
  lastSentAt: z.number().nullable(),
  notices: z.array(z.string()),
  /** True until the user dismisses the first-run tips. */
  showTips: z.boolean().optional(),
})
export type CanvasState = z.infer<typeof canvasState>

/** The host limits a page's request to 1 MiB, so uploads go in pieces well under that once base64-encoded. */
export const UPLOAD_CHUNK_BYTES = 512 * 1024
