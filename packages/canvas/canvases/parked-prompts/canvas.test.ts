import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UPLOAD_CHUNK_BYTES } from './shared.ts'
import { setup, type Setup } from './testSetup.ts'

let t: Setup
beforeEach(async () => { t = await setup() })
afterEach(() => t.close())

const invoke = <T = unknown>(action: string, input?: unknown) => t.harness.invoke('test', action as never, input as never, 'ui') as Promise<T>

async function upload(bytes: Buffer, name: string, id?: string) {
  const { uploadId } = await invoke<{ uploadId: string }>('begin_upload', { size: bytes.length })
  for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES) {
    await invoke('upload_chunk', { uploadId, data: bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES).toString('base64') })
  }
  return invoke<{ id: string }>('finish_upload', { uploadId, name, size: bytes.length, ...(id && { id }) })
}

describe('opening', () => {
  it('finds the repository and reads the store', async () => {
    await t.park('Already parked')
    await invoke('refresh')
    expect(t.state().repo).toMatchObject({ root: t.root, remote: 'github.com/o/r', label: 'o/r', isGit: true })
    expect(t.state().prompts.map(prompt => prompt.title)).toEqual(['Already parked'])
  })

  it('follows changes other processes make to the store', async () => {
    const prompt = await t.park('From the extension')
    await t.harness.runJob('tick')
    expect(t.state().prompts[0]?.status).toBe('parked')
    await t.catalog.global.update(prompt.id, { status: 'done', title: 'Renamed' })
    await t.harness.runJob('tick')
    expect(t.state().prompts[0]).toMatchObject({ status: 'done', title: 'Renamed' })
  })

  it('never keeps prompt bodies in its state, only short excerpts', async () => {
    await t.park(`Start ${'x'.repeat(5000)} secret-at-the-end`)
    await invoke('refresh')
    expect(JSON.stringify(t.state())).not.toContain('secret-at-the-end')
  })

  it('reads across repositories in the all view', async () => {
    await t.catalog.global.create({ body: 'Elsewhere', repo: { remote: 'github.com/x/y' } })
    await t.park('Here')
    await invoke('refresh')
    expect(t.state().prompts.map(prompt => prompt.title)).toEqual(['Here'])
    await invoke('set_scope', { scope: 'all' })
    expect(t.state().prompts.map(prompt => prompt.title).sort()).toEqual(['Elsewhere', 'Here'])
  })

  it('reports bad entries and carries on', async () => {
    await t.park('Good')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(t.home, 'broken-entry'))
    await invoke('refresh')
    expect(t.state().prompts).toHaveLength(1)
    expect(t.state().problems).toMatchObject([{ id: 'broken-entry' }])
  })
})

describe('the composer', () => {
  it('saves a draft, then parks it', async () => {
    const { id } = await invoke<{ id: string }>('save_prompt', { title: '', body: 'First draft' })
    expect((await t.catalog.global.get(id)).status).toBe('draft')
    await invoke('save_prompt', { id, title: 'Named', body: 'Second draft', status: 'parked' })
    expect(await t.catalog.global.get(id)).toMatchObject({ title: 'Named', body: 'Second draft', status: 'parked', repo: { remote: 'github.com/o/r', path: t.root } })
  })

  it('loads a prompt back for editing', async () => {
    const prompt = await t.park('Edit me')
    expect(await invoke('load_prompt', { store: 'global', id: prompt.id })).toMatchObject({ body: 'Edit me', status: 'parked' })
  })

  it('refers to repository files by path, and refuses paths that leave it', async () => {
    const { id } = await invoke<{ id: string }>('add_workspace_file', { reference: 'src/a.ts:2-4' })
    expect((await t.catalog.global.get(id)).attachments).toEqual([{ kind: 'workspace', path: 'src/a.ts', range: { startLine: 2, endLine: 4 } }])
    for (const reference of ['../../etc/passwd', '/etc/passwd', 'C:\\x']) {
      await expect(invoke('add_workspace_file', { id, reference })).rejects.toThrow(/inside this repository/)
    }
  })

  it('leaves no draft behind when an attachment fails', async () => {
    const { uploadId } = await invoke<{ uploadId: string }>('begin_upload', { size: 1 })
    await invoke('upload_chunk', { uploadId, data: Buffer.from('x').toString('base64') })
    await expect(invoke('finish_upload', { uploadId, name: 'a.txt', size: 2 })).rejects.toThrow(/did not finish/)
    expect((await t.catalog.global.list()).prompts).toEqual([])
  })

  it('attaches an empty file', async () => {
    const { id } = await upload(Buffer.alloc(0), 'empty.txt')
    expect((await t.catalog.global.get(id)).attachments[0]).toMatchObject({ name: 'empty.txt', size: 0 })
  })

  it('keeps a draft it did not create when an attachment fails', async () => {
    const prompt = await t.park('Already here')
    const { uploadId } = await invoke<{ uploadId: string }>('begin_upload', { size: 2 })
    await expect(invoke('finish_upload', { uploadId, id: prompt.id, name: 'a.txt', size: 2 })).rejects.toThrow(/did not finish/)
    expect((await t.catalog.global.get(prompt.id)).body).toBe('Already here')
  })

  it('says when the draft being saved is gone, so the page can keep the text', async () => {
    const prompt = await t.park('Deleted soon')
    await t.catalog.global.delete(prompt.id)
    await expect(invoke('save_prompt', { id: prompt.id, title: '', body: 'New text' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('removes an attachment', async () => {
    const { id } = await upload(Buffer.from('x'), 'a.txt')
    await invoke('remove_attachment', { id, path: 'attachments/a.txt' })
    expect((await t.catalog.global.get(id)).attachments).toEqual([])
  })
})

describe('uploads', () => {
  it('reassembles a file bigger than one request, creating a draft for it', async () => {
    const bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES * 2 + 123, 7)
    const { id } = await upload(bytes, 'big.png')
    const prompt = await t.catalog.global.get(id)
    expect(prompt.status).toBe('draft')
    expect(prompt.attachments[0]).toMatchObject({ kind: 'copy', name: 'big.png', size: bytes.length })
    expect((await readFile(join(prompt.dir, 'attachments/big.png'))).equals(bytes)).toBe(true)
  })

  it('keeps upload chunks within what the host accepts in one request', () => {
    const base64 = Math.ceil((UPLOAD_CHUNK_BYTES * 4) / 3)
    expect(base64 + 200).toBeLessThan(1024 * 1024)
  })

  it('refuses a file over the limit before receiving it', async () => {
    await expect(invoke('begin_upload', { size: 26 * 1024 * 1024 })).rejects.toThrow(/25 MB/)
  })

  it('refuses an upload that did not finish', async () => {
    const { uploadId } = await invoke<{ uploadId: string }>('begin_upload', { size: 10 })
    await invoke('upload_chunk', { uploadId, data: Buffer.from('short').toString('base64') })
    await expect(invoke('finish_upload', { uploadId, name: 'a.png', size: 10 })).rejects.toThrow(/did not finish/)
    expect(t.state().prompts).toEqual([])
  })

  it.each(['../../../etc/passwd', 'abc', `${'a'.repeat(24)}/../x`])('refuses the upload ID %s', async uploadId => {
    await expect(invoke('upload_chunk', { uploadId, data: 'eA==' })).rejects.toThrow()
    await expect(invoke('finish_upload', { uploadId, name: 'a', size: 1 })).rejects.toThrow()
  })

  it('gives images an ID the host accepts, whatever the file is called', async () => {
    await upload(Buffer.from('x'), 'my shot 世界 (1)~final.png')
    const fileId = t.state().prompts[0]?.attachments[0]?.fileId
    expect(fileId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/)
  })

  it('keeps the name safe', async () => {
    const { id } = await upload(Buffer.from('x'), '../../../.ssh/authorized_keys')
    const prompt = await t.catalog.global.get(id)
    expect(prompt.attachments[0]?.path).toBe('attachments/authorized_keys')
  })

  it('leaves nothing behind in its data folder', async () => {
    await upload(Buffer.from('x'), 'a.txt')
    expect(await readdir(join(t.harness.dataRoot, 'jamesmontemagno-parked-prompts', 'uploads'))).toEqual([])
  })
})

describe('moving to the repository', () => {
  it('lists what will be added, then moves it, without the local path', async () => {
    const prompt = await t.park('Share this')
    const plan = await invoke<{ hash: string; files: { path: string }[] }>('plan_move', { store: 'global', id: prompt.id })
    expect(plan.files.map(file => file.path)).toEqual([`.github/parked-prompts/${prompt.id}/prompt.md`])
    await invoke('move_to_repo', { id: prompt.id, hash: plan.hash })
    const moved = await t.catalog.repoStore?.get(prompt.id)
    expect(moved?.repo).toEqual({ remote: 'github.com/o/r' })
    expect(t.state().prompts[0]).toMatchObject({ store: 'repo', needsConfirmation: false })
    expect(t.state().prompts[0]?.needsConfirmation).toBe(false)
    await expect(t.catalog.global.get(prompt.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('does not ask you to confirm your own prompt, even when it refers to a file', async () => {
    const prompt = await t.park('Share this')
    await t.catalog.global.addWorkspaceFile(prompt.id, 'src/a.ts')
    const plan = await invoke<{ hash: string }>('plan_move', { store: 'global', id: prompt.id })
    await invoke('move_to_repo', { id: prompt.id, hash: plan.hash })
    expect(t.state().prompts[0]).toMatchObject({ store: 'repo', needsConfirmation: false })
  })

  it('refuses when the prompt changed after the plan', async () => {
    const prompt = await t.park('Share this')
    const plan = await invoke<{ hash: string }>('plan_move', { store: 'global', id: prompt.id })
    await t.catalog.global.update(prompt.id, { body: 'Now with a secret' })
    await expect(invoke('move_to_repo', { id: prompt.id, hash: plan.hash })).rejects.toThrow(/changed/)
  })
})
