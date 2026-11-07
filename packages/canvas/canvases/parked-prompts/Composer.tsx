import { useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ReactNode, type Ref } from 'react'
import { CanvasActionError, createCanvasHooks, getCanvasClient } from '@rwoll/canvas-kit/react'
import { BookmarkIcon, CloseIcon, FileIcon, PaperclipIcon } from '../../ui'
import type canvas from './canvas.ts'
import { UPLOAD_CHUNK_BYTES, type PromptSummary } from './shared.ts'

const { useCanvas } = createCanvasHooks<typeof canvas>()

const SAVE_DELAY_MS = 400

const toBase64 = (bytes: ArrayBuffer): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(new Blob([bytes]))
  })

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString()
}

const imageUrl = (fileId: string) => getCanvasClient<typeof canvas>().fileUrl(fileId)

function Attachments({ prompt, onRemove, disabled = false }: { prompt: PromptSummary; onRemove?: (path: string, startLine?: number, endLine?: number) => void; disabled?: boolean }) {
  if (prompt.attachments.length === 0) return null
  return (
    <ul className="attachments" aria-label="Attachments">
      {prompt.attachments.map(item => (
        <li key={`${item.path}:${item.startLine ?? ''}`} className={item.missing && item.missing !== 'no-workspace' ? 'attachment missing' : 'attachment'}>
          {item.fileId ? <img src={imageUrl(item.fileId)} alt={item.label} /> : <FileIcon />}
          <span className="attachment-label" title={item.label}>{item.label}</span>
          {item.missing === 'no-workspace' && <span className="muted"> (other workspace)</span>}
          {item.missing && item.missing !== 'no-workspace' && <span> ({item.missing === 'blocked' ? 'blocked' : 'missing'})</span>}
          {onRemove && (
            <button type="button" className="attachment-remove" aria-label={`Remove ${item.label}`} title="Remove" disabled={disabled} onClick={() => onRemove(item.path, item.startLine, item.endLine)}><CloseIcon /></button>
          )}
        </li>
      ))}
    </ul>
  )
}

interface Draft {
  id?: string | undefined
  title: string
  body: string
  status: 'draft' | 'parked' | 'done'
}

interface ComposerHandle {
  prepareForEdit: () => Promise<boolean>
}

const emptyDraft = (): Draft => ({ title: '', body: '', status: 'draft' })

function Composer({ editing, onDoneEditing, busy, ref }: { editing: Draft | undefined; onDoneEditing: () => void; busy: boolean; ref: Ref<ComposerHandle> }) {
  const { state, run } = useCanvas()
  const [draft, setDraft] = useState<Draft>(() => editing ?? emptyDraft())
  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const failures = useRef(0)
  const latest = useRef(draft)
  const dirty = useRef(false)

  // Goes up when the composer moves on, so a late reply cannot land on the next prompt.
  const generation = useRef(0)

  // One at a time, so a slow first save cannot create two drafts.
  const enqueue = <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    const step = queue.current.then(task).catch((error: Error) => {
      failures.current += 1
      setNote(error.message)
      return undefined
    })
    queue.current = step
    return step
  }

  /** Resolves to true once the text is safely stored. A failure leaves it in the composer. */
  const saveNow = () =>
    enqueue(async () => {
      const started = generation.current
      const { id, title, body } = latest.current
      if (!id && !title.trim() && !body.trim()) {
        dirty.current = false
        return true
      }
      const fields = { title, body }
      let saved
      try {
        saved = await run('save_prompt', { ...(id && { id }), ...fields })
      } catch (error) {
        if (!(error instanceof CanvasActionError) || error.code !== 'not_found') throw new Error(`Not saved: ${(error as Error).message}`)
        // It was deleted somewhere else. The text in front of the user still matters, so keep it as a new draft.
        saved = await run('save_prompt', fields)
        latest.current = { ...latest.current, status: 'draft' }
      }
      if (generation.current === started) {
        latest.current = { ...latest.current, id: saved.id }
        if (latest.current.title === title && latest.current.body === body) dirty.current = false
        setDraft(latest.current)
        setNote(latest.current.status === 'draft' ? 'Draft saved' : 'Saved')
      }
      return true
    })

  useImperativeHandle(ref, () => ({
    prepareForEdit: async () => {
      clearTimeout(timer.current)
      const previousFailures = failures.current
      await queue.current
      if (failures.current !== previousFailures) return false
      return !dirty.current || (await saveNow()) === true
    },
  }))

  useEffect(() => () => clearTimeout(timer.current), [])

  const change = (patch: Partial<Draft>) => {
    const next = { ...latest.current, ...patch }
    dirty.current = true
    latest.current = next
    setDraft(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void saveNow(), SAVE_DELAY_MS)
  }

  const reset = (message = '') => {
    clearTimeout(timer.current)
    generation.current += 1
    dirty.current = false
    latest.current = emptyDraft()
    setDraft(latest.current)
    setNote(message)
    onDoneEditing()
  }

  const park = async () => {
    clearTimeout(timer.current)
    if (!(await saveNow())) return
    const { id, status, title, body } = latest.current
    if (!id) return
    if (status === 'draft') await run('save_prompt', { id, title, body, status: 'parked' })
    reset(status === 'draft' ? 'Parked' : 'Saved')
  }

  const discard = async () => {
    clearTimeout(timer.current)
    await queue.current
    const { id } = latest.current
    reset()
    if (id) void enqueue(() => run('delete_prompt', { store: 'global', id }))
  }

  const upload = (file: File, name = file.name) =>
    enqueue(async () => {
      setNote(`Attaching ${name}…`)
      const { uploadId } = await run('begin_upload', { size: file.size })
      for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
        const piece = await file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer()
        await run('upload_chunk', { uploadId, data: await toBase64(piece) })
      }
      const { id } = latest.current
      const saved = await run('finish_upload', { uploadId, name, size: file.size, ...(id && { id }), ...(file.type && { mime: file.type }) })
      setDraft(current => ({ ...current, id: saved.id }))
      latest.current = { ...latest.current, id: saved.id }
      setNote('Attached')
    })

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) {
      const extension = file.type.split('/')[1] ?? 'png'
      void upload(file, file.name && file.name !== 'image.png' ? file.name : `pasted-${Date.now()}.${extension}`)
    }
  }

  const addReference = () =>
    enqueue(async () => {
      const { id } = latest.current
      const saved = await run('add_workspace_file', { reference: reference.trim(), ...(id && { id }) })
      setDraft(current => ({ ...current, id: saved.id }))
      latest.current = { ...latest.current, id: saved.id }
      setReference('')
      setNote('Attached')
    })

  const current = state.prompts.find(prompt => prompt.id === draft.id && prompt.store === 'global')
  const hasContent = draft.body.trim().length > 0 || (current?.attachments.length ?? 0) > 0
  return (
    <section className="block composer" aria-label="New prompt" aria-busy={busy}>
      <input type="text" className="composer-title" aria-label="Title" placeholder="Title (optional)" maxLength={200} disabled={busy} value={draft.title} onChange={event => change({ title: event.target.value })} />
      <textarea className="composer-body" aria-label="Prompt text" placeholder="Write a prompt to save for later. Paste images, or attach files." rows={3} disabled={busy} value={draft.body} onPaste={onPaste} onChange={event => change({ body: event.target.value })} />
      {current && current.attachments.length > 0 && <Attachments prompt={current} disabled={busy} onRemove={(path, startLine, endLine) => void enqueue(() => run('remove_attachment', { id: current.id, path, ...(startLine && endLine && { startLine, endLine }) }))} />}
      <div className="button-row composer-tools">
        <label className="file-button" aria-disabled={busy}>
          <PaperclipIcon />
          Attach files
          <input type="file" multiple aria-label="Attach files" disabled={busy} onChange={event => { for (const file of event.target.files ?? []) void upload(file); event.target.value = '' }} />
        </label>
        {state.repo?.isGit && (
          <form className="reference" onSubmit={event => { event.preventDefault(); if (!busy && reference.trim()) void addReference() }}>
            <input type="text" aria-label="Repository file" placeholder="src/a.ts:10-20" disabled={busy} value={reference} onChange={event => setReference(event.target.value)} />
            <button type="submit" disabled={busy || !reference.trim()}>Add file</button>
          </form>
        )}
      </div>
      <div className="composer-actions">
        {draft.id && draft.status === 'draft' && <button type="button" disabled={busy} onClick={() => void discard()}>Discard</button>}
        <button type="button" className="primary" disabled={busy || !hasContent} onClick={() => void park()}><BookmarkIcon />{draft.status === 'draft' ? 'Park' : 'Done editing'}</button>
      </div>
      <span className="notice composer-status" role="status">{busy ? 'Opening prompt…' : note}</span>
    </section>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} aria-label={title}>
      <div className="dialog-form">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  )
}

interface Review {
  ref: Pick<PromptSummary, 'id' | 'store'>
  title: string
  hash: string
  text: string
  attachments: string[]
  warnings: string[]
}

function ReviewDialog({ review, onClose }: { review: Review; onClose: () => void }) {
  const { run } = useCanvas()
  const [error, setError] = useState('')
  const accept = () => void run('confirm_repo_prompt', { ...review.ref, hash: review.hash }).then(onClose, (failure: Error) => setError(failure.message))
  return (
    <Dialog title={`Review "${review.title}"`} onClose={onClose}>
      <p className="muted">This prompt is stored in the repository, so anyone with commit access could have written it. It would instruct your agent. Read it before using it.</p>
      {review.warnings.map(warning => <p key={warning} className="notice warn">{warning}</p>)}
      <pre className="quote review-text">{review.text}</pre>
      {review.attachments.length > 0 && <p className="muted">Attachments: {review.attachments.join(', ')}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="button-row end">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" onClick={accept}>I read it, allow it</button>
      </div>
    </Dialog>
  )
}

export { Attachments, Composer, Dialog, ReviewDialog, timeAgo, useCanvas }
export type { ComposerHandle, Review, Draft }
