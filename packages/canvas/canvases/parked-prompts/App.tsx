import { useState } from 'react'
import { Header } from '../../ui'
import '../../ui/theme.css'
import './App.css'
import { Attachments, Composer, Dialog, ReviewDialog, timeAgo, useCanvas, type Draft, type Review } from './Composer.tsx'
import type { PromptSummary } from './shared.ts'

interface MovePlan {
  id: string
  hash: string
  files: { path: string }[]
  references: string[]
  warnings: string[]
  blockers: string[]
}

function Row({ prompt, armed, onEdit, onReview, onMove }: { prompt: PromptSummary; armed: boolean; onEdit: () => void; onReview: () => void; onMove: () => void }) {
  const { state, run } = useCanvas()
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const ref = { store: prompt.store, id: prompt.id }
  const act = (task: () => Promise<unknown>) => () => void task().then(() => setError(''), (failure: Error) => setError(failure.message))
  const details = [state.scope === 'all' || !prompt.inCurrentRepo ? prompt.repoLabel : undefined, timeAgo(prompt.updatedAt)].filter(Boolean).join(' · ')
  return (
    <li className={`prompt status-${prompt.status}`}>
      <div className="prompt-head">
        <span className="prompt-title">{prompt.title}</span>
        {prompt.store === 'repo' && <span className="badge state-waiting" title="Stored in the repository. It arrived by Git, so read it before using it.">Repo</span>}
        {armed && <span className="badge state-running">Waiting for idle</span>}
      </div>
      {prompt.excerpt && prompt.excerpt !== prompt.title && <p className="prompt-excerpt">{prompt.excerpt}</p>}
      <Attachments prompt={prompt} />
      {prompt.warnings.map(warning => <p key={warning} className="notice warn">{warning}</p>)}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="prompt-foot">
        <span className="muted time">{details}</span>
        <span className="spacer" />
        {prompt.needsConfirmation ? (
          <button type="button" className="primary" onClick={onReview}>Review</button>
        ) : prompt.status !== 'done' && (
          <>
            <button type="button" title="Send it to this session now" onClick={act(() => run('send_now', ref))}>Send</button>
            <button type="button" title="Send it after the agent's current turn" onClick={act(() => run('queue_prompt', ref))}>Queue</button>
            {armed
              ? <button type="button" onClick={act(() => run('disarm', ref))}>Cancel wait</button>
              : <button type="button" title="Send it the next time the agent is idle, while this canvas stays open" onClick={act(() => run('arm_idle', ref))}>When idle</button>}
          </>
        )}
        {prompt.store === 'global' && <button type="button" className="link" onClick={onEdit}>Edit</button>}
        {prompt.store === 'global' && state.repo?.isGit && <button type="button" className="link" onClick={onMove}>Move to repo</button>}
        {prompt.status === 'done'
          ? <button type="button" className="link" onClick={act(() => run('set_status', { ...ref, status: 'parked' }))}>Reopen</button>
          : <button type="button" className="link" onClick={act(() => run('set_status', { ...ref, status: 'done' }))}>Done</button>}
        {confirmingDelete
          ? <button type="button" className="link danger" onClick={act(() => run('delete_prompt', ref))}>Confirm delete</button>
          : <button type="button" className="link" onClick={() => setConfirmingDelete(true)}>Delete</button>}
      </div>
    </li>
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

function Group({ title, prompts, children }: { title: string; prompts: PromptSummary[]; children: (prompt: PromptSummary) => React.ReactNode }) {
  if (prompts.length === 0) return null
  return (
    <section className="block">
      <h2 className="label">{title} ({prompts.length})</h2>
      <ul className="rows">{prompts.map(children)}</ul>
    </section>
  )
}

export default function App() {
  const { state, agent, status, run } = useCanvas()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Draft>()
  const [review, setReview] = useState<Review>()
  const [plan, setPlan] = useState<MovePlan>()
  const [error, setError] = useState('')

  const fail = (failure: Error) => setError(failure.message)
  const edit = (prompt: PromptSummary) => void run('load_prompt', { store: prompt.store, id: prompt.id }).then(loaded => {
    setEditing({ id: loaded.id, title: loaded.title, body: loaded.body, mode: loaded.mode, status: loaded.status })
    setError('')
  }, fail)
  const startReview = (prompt: PromptSummary) => void run('preview_repo_prompt', { store: prompt.store, id: prompt.id }).then(preview => {
    setReview({ ref: { store: prompt.store, id: prompt.id }, title: preview.title, hash: preview.hash, text: preview.text, attachments: preview.attachments, warnings: preview.warnings })
  }, fail)
  const startMove = (prompt: PromptSummary) => void run('plan_move', { store: prompt.store, id: prompt.id }).then(next => setPlan({ ...next, id: prompt.id }), fail)

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = state.prompts.filter(prompt => {
    const haystack = `${prompt.title}\n${prompt.excerpt}\n${prompt.repoLabel ?? ''}`.toLowerCase()
    return words.every(word => haystack.includes(word))
  })
  const row = (prompt: PromptSummary) => (
    <Row
      key={`${prompt.store}:${prompt.id}`}
      prompt={prompt}
      armed={state.armed.some(item => item.id === prompt.id && item.store === prompt.store)}
      onEdit={() => edit(prompt)}
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
      <Header title="Parked prompts" badge={badge}>
        <div className="scope" role="group" aria-label="Which prompts to show">
          <button type="button" aria-pressed={state.scope === 'repo'} onClick={() => void run('set_scope', { scope: 'repo' }).catch(fail)}>{state.repo?.label ?? 'No repo'}</button>
          <button type="button" aria-pressed={state.scope === 'all'} onClick={() => void run('set_scope', { scope: 'all' }).catch(fail)}>All repos</button>
        </div>
      </Header>
      <main className="page">
        <Composer editing={editing} onDoneEditing={() => setEditing(undefined)} />
        {state.armed.length > 0 && (
          <p className="banner callout" role="status">
            {state.armed.length === 1 ? `"${state.armed[0]?.title}" sends` : `${state.armed.length} prompts send, one at a time,`} when the agent is next idle. This only happens while this canvas stays open.
          </p>
        )}
        {state.notices.length > 0 && (
          <div className="banner attention" role="status">
            {state.notices.map(notice => <p key={notice}>{notice}</p>)}
            <button type="button" className="link" onClick={() => void run('dismiss_notice').catch(fail)}>Dismiss</button>
          </div>
        )}
        {error && <p role="alert" className="error">{error}</p>}
        <input type="search" className="search" aria-label="Search parked prompts" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />
        <Group title="Drafts" prompts={shown.filter(prompt => prompt.status === 'draft')}>{row}</Group>
        <Group title="Parked" prompts={shown.filter(prompt => prompt.status === 'parked')}>{row}</Group>
        <Group title="Done" prompts={shown.filter(prompt => prompt.status === 'done')}>{row}</Group>
        {shown.length === 0 && <p className="muted">{query ? 'Nothing matches that search.' : 'Nothing parked here yet.'}</p>}
        {state.problems.length > 0 && <p className="notice warn">{state.problems.length} saved {state.problems.length === 1 ? 'entry' : 'entries'} could not be read: {state.problems.map(problem => problem.id).join(', ')}</p>}
      </main>
      {review && <ReviewDialog review={review} onClose={() => setReview(undefined)} />}
      {plan && <MoveDialog plan={plan} onClose={() => setPlan(undefined)} />}
    </>
  )
}
