import { useEffect, useRef, useState } from 'react'
import { repoDisplayName } from '@parked-prompts/core/remote'
import { CheckIcon, ClockIcon, CloseIcon, CopyIcon, EditIcon, Header, InfoIcon, LogoIcon, MoveToRepoIcon, QueueIcon, SearchIcon, SendIcon, SparkleIcon, SweepIcon, TrashIcon } from '../../ui'
import '../../ui/theme.css'
import './App.css'
import { Attachments, Composer, Dialog, ReviewDialog, timeAgo, useCanvas, type ComposerHandle, type Draft, type Review } from './Composer.tsx'
import type { CanvasState, PromptRefInput, PromptSummary } from './shared.ts'

interface MovePlan {
  id: string
  hash: string
  files: { path: string }[]
  references: string[]
  warnings: string[]
  blockers: string[]
}

interface ClearPlan {
  prompts: (PromptRefInput & { revision: string })[]
}

interface ClearResult {
  cleared: number
  changed: number
  failures: (PromptRefInput & { message: string })[]
  refreshError?: string
}

// The canvas frame may not be allowed the async clipboard API, so fall back to a selection copy.
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.className = 'copy-buffer'
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    if (!copied) throw new Error('Could not copy to the clipboard.')
  }
}

function Row({ prompt, armed, editingDisabled, onEdit, onReview, onMove }: { prompt: PromptSummary; armed: boolean; editingDisabled: boolean; onEdit: () => void; onReview: () => void; onMove: () => void }) {
  const { state, run } = useCanvas()
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = { store: prompt.store, id: prompt.id }
  const act = (task: () => Promise<unknown>) => () => void task().then(() => setError(''), (failure: Error) => setError(failure.message))
  const copy = act(async () => {
    const { body } = await run('copy_prompt', ref)
    await copyText(body)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  })
  // The excerpt, without repeating a title that came from the same text.
  const titleText = prompt.title.replace(/…$/, '')
  const summary = prompt.excerpt.startsWith(titleText) ? prompt.excerpt.slice(titleText.length).trim() : prompt.excerpt
  const repoLabel = state.scope === 'all' || !prompt.inCurrentRepo ? prompt.repoLabel : undefined
  return (
    <li className={['prompt', prompt.status === 'done' && 'is-done', armed && 'is-armed', prompt.needsConfirmation && 'needs-review'].filter(Boolean).join(' ')}>
      <div className="prompt-head">
        <span className="prompt-title">{prompt.title}</span>
        {prompt.store === 'repo' && <span className="badge state-waiting" title="Stored in the repository. It arrived by Git, so read it before using it.">Repo</span>}
        {armed && <span className="badge state-running">Waiting for idle</span>}
        {prompt.model && (
          <span className="model-chip" title={`Model chosen in VS Code: ${prompt.model}. Sending from here uses this session's model.`}>
            <SparkleIcon />
            <span className="sr-only">Model: </span>
            <span className="model-name">{prompt.model}</span>
          </span>
        )}
        <span className="muted time">
          {repoLabel && <><span title={repoLabel}><span aria-hidden="true">{repoDisplayName(repoLabel)}</span><span className="sr-only">{repoLabel}</span></span>{' · '}</>}
          {timeAgo(prompt.updatedAt)}
        </span>
      </div>
      {summary && <p className="prompt-excerpt">{summary}</p>}
      <Attachments prompt={prompt} />
      {prompt.warnings.map(warning => <p key={warning} className="notice warn">{warning}</p>)}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="prompt-foot">
        {prompt.needsConfirmation ? (
          <button type="button" className="primary" onClick={onReview}>Review</button>
        ) : prompt.status !== 'done' && (
          <div className="send-actions" role="group" aria-label="Send this prompt">
            <button type="button" className="send" title="Send it to this session now" onClick={act(() => run('send_now', ref))}><SendIcon />Send</button>
            <button type="button" title="Send it after the agent's current turn" onClick={act(() => run('queue_prompt', ref))}><QueueIcon />Queue</button>
            {armed
              ? <button type="button" onClick={act(() => run('disarm', ref))}><ClockIcon />Cancel wait</button>
              : <button type="button" title="Send it the next time the agent is idle, while this canvas stays open" onClick={act(() => run('arm_idle', ref))}><ClockIcon />When idle</button>}
            <button type="button" title="Copy the text to paste into the chat box and edit before sending. Attachments are not copied." onClick={copy}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? 'Copied' : 'Copy'}</button>
          </div>
        )}
        <span className="spacer" />
        {prompt.store === 'global' && <button type="button" className="link icon-action" aria-label="Edit" title="Edit" disabled={editingDisabled} onClick={onEdit}><EditIcon /></button>}
        {prompt.store === 'global' && state.repo?.isGit && <button type="button" className="link icon-action" aria-label="Move to repo" title="Move to repo" onClick={onMove}><MoveToRepoIcon /></button>}
        {prompt.status === 'done'
          ? <button type="button" className="link" onClick={act(() => run('set_status', { ...ref, status: 'parked' }))}>Reopen</button>
          : <button type="button" className="link icon-action" aria-label="Done" title="Done" onClick={act(() => run('set_status', { ...ref, status: 'done' }))}><CheckIcon /></button>}
        {confirmingDelete
          ? <button type="button" className="link danger" onClick={act(() => run('delete_prompt', ref))}>Confirm delete</button>
          : <button type="button" className="link icon-action" aria-label="Delete" title="Delete" onClick={() => setConfirmingDelete(true)}><TrashIcon /></button>}
      </div>
    </li>
  )
}

const TIPS: readonly (readonly [string, string])[] = [
  ['Write it, park it.', 'Drafts save as you type. Park sets a prompt aside until you need it.'],
  ['Images and files.', 'Paste an image, attach files, or point at a repository file such as src/a.ts:10-20.'],
  ['Send, Queue, or When idle.', 'Send now, after the current turn, or the next time the agent is idle while this canvas stays open.'],
  ['Copy to edit first.', 'Copy the text to paste into the chat box. Attachments are not copied.'],
  ['Done and clear.', 'Sent prompts are marked done. The sweep button clears the done prompts shown.'],
  ['Repository prompts.', 'Prompts stored in the repository arrived by Git, so review them before sending.'],
]

/** First-run tips, reopened from the info button. It never blocks the rest of the canvas. */
function Tips({ onClose }: { onClose: () => void }) {
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (document.activeElement?.id === 'tips-button') title.current?.focus() }, [])
  return (
    <section id="parked-tips" className="tips" aria-labelledby="tips-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="tips-head">
        <InfoIcon />
        <h2 id="tips-title" className="tips-title" ref={title} tabIndex={-1}>Tips for Parked Prompts</h2>
        <button type="button" className="link icon-action" aria-label="Close tips" title="Close tips" onClick={onClose}><CloseIcon /></button>
      </div>
      <ul className="tips-list">{TIPS.map(([lead, text]) => <li key={lead}><strong>{lead}</strong> {text}</li>)}</ul>
      <div className="tips-foot">
        <span className="muted">Reopen these from the info button.</span>
        <button type="button" className="primary" onClick={onClose}>Got it</button>
      </div>
    </section>
  )
}

function MoveDialog({ plan, onClose }: { plan: MovePlan; onClose: () => void }) {
  const { run } = useCanvas()
  const [error, setError] = useState('')
  const move = () => void run('move_to_repo', { id: plan.id, hash: plan.hash }).then(onClose, (failure: Error) => setError(failure.message))
  return (
    <Dialog title="Move into this repository?" onClose={onClose}>
      <p className="muted">These files will be added to the repository. They are not committed for you.</p>
      <ul className="bullets mono">{plan.files.map(file => <li key={file.path}>{file.path}</li>)}</ul>
      {plan.references.length > 0 && <p className="muted">Stays a reference, not copied: {plan.references.join(', ')}</p>}
      {plan.warnings.map(warning => <p key={warning} className="notice warn">{warning}</p>)}
      {plan.blockers.map(blocker => <p key={blocker} role="alert" className="error">{blocker}</p>)}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="button-row end">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={plan.blockers.length > 0} onClick={move}>{plan.warnings.length > 0 ? 'Move anyway' : 'Move'}</button>
      </div>
    </Dialog>
  )
}

function Group({ title, prompts, children, action, details }: { title: string; prompts: PromptSummary[]; children: (prompt: PromptSummary) => React.ReactNode; action?: React.ReactNode; details?: React.ReactNode }) {
  if (prompts.length === 0) return null
  return (
    <section className="block">
      <div className="group-heading">
        <h2 className="label group-title" aria-label={`${title} (${prompts.length})`}>{title}<span className="count">{prompts.length}</span></h2>
        {action}
      </div>
      {details}
      <ul className="rows prompt-list">{prompts.map(children)}</ul>
    </section>
  )
}

function DoneGroup({ scope, prompts, children, onResult }: { scope: CanvasState['scope']; prompts: PromptSummary[]; children: (prompt: PromptSummary) => React.ReactNode; onResult: (result: ClearResult) => void }) {
  const { run } = useCanvas()
  const [plan, setPlan] = useState<ClearPlan>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      setPlan(await run('plan_clear_done', { scope, prompts: prompts.map(({ id, store }) => ({ id, store })) }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    if (!plan) return
    setBusy(true)
    setError('')
    try {
      const result = await run('clear_done', { scope, prompts: plan.prompts })
      onResult(result)
      setPlan(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  const repoCount = plan?.prompts.filter(prompt => prompt.store === 'repo').length ?? 0
  return (
    <Group
      title="Done"
      prompts={prompts}
      action={<button type="button" className="link icon-action" aria-label="Clear done" title="Clear shown completed prompts" aria-expanded={Boolean(plan)} aria-controls="clear-done-confirmation" disabled={busy} onClick={() => plan ? setPlan(undefined) : void prepare()}><SweepIcon /></button>}
      details={(
        <>
          {error && <p role="alert" className="error">{error}</p>}
          {plan && (
            <div id="clear-done-confirmation" className="clear-confirm" role="group" aria-label="Confirm clearing completed prompts">
              <p>Permanently delete {plan.prompts.length} selected completed {plan.prompts.length === 1 ? 'prompt' : 'prompts'} and their copied attachments? Referenced workspace files are kept.</p>
              {repoCount > 0 && <p className="notice warn">{repoCount} {repoCount === 1 ? 'prompt is' : 'prompts are'} stored in this repository; their files will be removed from the working tree.</p>}
              <div className="button-row end">
                <button type="button" disabled={busy} onClick={() => setPlan(undefined)}>Cancel</button>
                <button type="button" className="link danger" disabled={busy} onClick={() => void clear()}>{busy ? 'Deleting…' : 'Delete completed prompts'}</button>
              </div>
            </div>
          )}
        </>
      )}
    >{children}</Group>
  )
}

export default function App() {
  const { state, agent, status, run } = useCanvas()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Draft>()
  const [openingEdit, setOpeningEdit] = useState(false)
  const openingEditRef = useRef(false)
  const composerRef = useRef<ComposerHandle>(null)
  const [review, setReview] = useState<Review>()
  const [plan, setPlan] = useState<MovePlan>()
  const [error, setError] = useState('')
  const [clearNotice, setClearNotice] = useState('')
  const [tipsOpen, setTipsOpen] = useState(false)
  const tipsShown = useRef(false)
  const tipsButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (state.showTips && !tipsShown.current) {
      tipsShown.current = true
      setTipsOpen(true)
    }
  }, [state.showTips])
  const closeTips = () => {
    const hadFocus = document.getElementById('parked-tips')?.contains(document.activeElement) ?? false
    setTipsOpen(false)
    if (state.showTips) void run('dismiss_tips').catch((failure: Error) => setError(failure.message))
    if (hadFocus) tipsButton.current?.focus()
  }

  const fail = (failure: Error) => setError(failure.message)
  const edit = async (prompt: PromptSummary) => {
    if (openingEditRef.current) return
    openingEditRef.current = true
    setOpeningEdit(true)
    try {
      if (!composerRef.current) throw new Error('The prompt editor is not ready yet.')
      if (!(await composerRef.current.prepareForEdit())) return
      const loaded = await run('load_prompt', { store: prompt.store, id: prompt.id })
      setEditing({ id: loaded.id, title: loaded.title, body: loaded.body, status: loaded.status })
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      openingEditRef.current = false
      setOpeningEdit(false)
    }
  }
  const startReview = (prompt: PromptSummary) => void run('preview_repo_prompt', { store: prompt.store, id: prompt.id }).then(preview => {
    setReview({ ref: { store: prompt.store, id: prompt.id }, title: preview.title, hash: preview.hash, text: preview.text, attachments: preview.attachments, warnings: preview.warnings })
  }, fail)
  const startMove = (prompt: PromptSummary) => void run('plan_move', { store: prompt.store, id: prompt.id }).then(next => setPlan({ ...next, id: prompt.id }), fail)
  const reportClear = (result: ClearResult) => {
    const messages = [`Deleted ${result.cleared} completed ${result.cleared === 1 ? 'prompt' : 'prompts'}.`]
    if (result.changed > 0) messages.push(`${result.changed} changed or no longer existed and were not deleted.`)
    for (const failure of result.failures) messages.push(`Could not delete ${failure.store}:${failure.id}: ${failure.message}`)
    if (result.refreshError) messages.push(`Could not refresh the list: ${result.refreshError}`)
    const text = messages.join(' ')
    if (result.failures.length > 0 || result.refreshError) {
      setClearNotice('')
      setError(text)
    } else {
      setError('')
      setClearNotice(text)
    }
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = state.prompts.filter(prompt => {
    const haystack = `${prompt.title}\n${prompt.excerpt}\n${prompt.repoLabel ?? ''}\n${prompt.model ?? ''}`.toLowerCase()
    return words.every(word => haystack.includes(word))
  })
  const done = shown.filter(prompt => prompt.status === 'done')
  const doneKey = JSON.stringify([state.scope, query, done.map(prompt => `${prompt.store}:${prompt.id}`).sort()])
  const row = (prompt: PromptSummary) => (
    <Row
      key={`${prompt.store}:${prompt.id}`}
      prompt={prompt}
      armed={state.armed.some(item => item.id === prompt.id && item.store === prompt.store)}
      editingDisabled={openingEdit}
      onEdit={() => void edit(prompt)}
      onReview={() => startReview(prompt)}
      onMove={() => startMove(prompt)}
    />
  )
  const badge = status !== 'live'
    ? <span className="pill status-waiting">{status === 'connecting' ? 'Connecting' : 'Offline'}</span>
    : agent.busy
      ? <span className="pill status-working">Agent busy</span>
      : <span className="pill status-idle">Agent idle</span>

  return (
    <>
      <Header title="Parked prompts" icon={<LogoIcon />} badge={badge}>
        <div className="scope" role="group" aria-label="Which prompts to show">
          <button type="button" title={state.repo?.label} aria-label={state.repo?.label} aria-pressed={state.scope === 'repo'} onClick={() => void run('set_scope', { scope: 'repo' }).catch(fail)}>{state.repo?.label ? repoDisplayName(state.repo.label) : 'No repo'}</button>
          <button type="button" aria-pressed={state.scope === 'all'} onClick={() => void run('set_scope', { scope: 'all' }).catch(fail)}>All repos</button>
        </div>
        <button type="button" id="tips-button" ref={tipsButton} className="link icon-action" aria-label="Tips and key features" title="Tips and key features" aria-expanded={tipsOpen} aria-controls="parked-tips" onClick={() => (tipsOpen ? closeTips() : setTipsOpen(true))}><InfoIcon /></button>
      </Header>
      <main className="page">
        {tipsOpen && <Tips onClose={closeTips} />}
        <Composer key={editing?.id ?? 'new'} ref={composerRef} editing={editing} busy={openingEdit} onDoneEditing={() => setEditing(undefined)} />
        {state.armed.length > 0 && (
          <p className="callout" role="status">
            {state.armed.length === 1 ? `"${state.armed[0]?.title}" sends` : `${state.armed.length} prompts send, one at a time,`} when the agent is next idle. This only happens while this canvas stays open.
          </p>
        )}
        {state.notices.length > 0 && (
          <div className="attention" role="status">
            {state.notices.map(notice => <p key={notice}>{notice}</p>)}
            <button type="button" className="link" onClick={() => void run('dismiss_notice').catch(fail)}>Dismiss</button>
          </div>
        )}
        {error && <p role="alert" className="error">{error}</p>}
        {clearNotice && <p role="status" className="notice">{clearNotice}</p>}
        <div className="search-box">
          <SearchIcon />
          <input type="search" className="search" aria-label="Search parked prompts" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <Group title="Drafts" prompts={shown.filter(prompt => prompt.status === 'draft')}>{row}</Group>
        <Group title="Parked" prompts={shown.filter(prompt => prompt.status === 'parked')}>{row}</Group>
        {done.length > 0 && <DoneGroup key={doneKey} scope={state.scope} prompts={done} onResult={reportClear}>{row}</DoneGroup>}
        {shown.length === 0 && (
          <div className="empty">
            {query ? <SearchIcon /> : <LogoIcon />}
            <p>{query ? 'Nothing matches that search.' : 'Nothing parked here yet.'}</p>
          </div>
        )}
        {state.problems.length > 0 && <p className="notice warn">{state.problems.length} saved {state.problems.length === 1 ? 'entry' : 'entries'} could not be read: {state.problems.map(problem => problem.id).join(', ')}</p>}
      </main>
      {review && <ReviewDialog review={review} onClose={() => setReview(undefined)} />}
      {plan && <MoveDialog plan={plan} onClose={() => setPlan(undefined)} />}
    </>
  )
}
