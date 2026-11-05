import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PromptCatalog, readRepoInfo } from '@parked-prompts/core'
import { createTestCanvas } from '@rwoll/canvas-kit/testing'
import canvas from './canvas.ts'

export const REPO_INPUT = (root: string) => ({ repoPath: root })

/** A temporary home and Git repository, with the canvas open on them. */
export async function setup(options: { sendToAgent?: () => Promise<void> } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'parked-canvas-'))
  const home = join(scratch, 'home')
  const root = join(scratch, 'repo')
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, 'src'))
  await writeFile(join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/r.git\n')
  await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  process.env.PARKED_PROMPTS_HOME = home

  const repo = await readRepoInfo(root)
  const catalog = new PromptCatalog({ home, ...(repo && { repo }) })
  let time = Date.parse('2026-06-01T00:00:00Z')
  const harness = await createTestCanvas(canvas, { now: () => time, ...(options.sendToAgent && { sendToAgent: options.sendToAgent }) })
  await harness.open('test', REPO_INPUT(root))

  return {
    home,
    root,
    catalog,
    harness,
    advance: (ms: number) => { time += ms },
    now: () => time,
    state: () => {
      const state = harness.state('test')
      if (!state) throw new Error('The canvas has no state.')
      return state
    },
    park: (body: string) => catalog.global.create({ body, repo: { remote: 'github.com/o/r', path: root } }),
    close: async () => {
      await harness.close()
      delete process.env.PARKED_PROMPTS_HOME
      await rm(scratch, { recursive: true, force: true })
    },
  }
}

export type Setup = Awaited<ReturnType<typeof setup>>
