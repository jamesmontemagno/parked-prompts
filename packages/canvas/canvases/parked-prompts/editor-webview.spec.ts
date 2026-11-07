import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import type { PromptView, ToHost, ViewState } from '../../../extension/src/protocol.ts'
import { bundleWebview } from '../../../extension/test/webview/bundle.mts'

declare global {
  interface Window {
    capturedMessages: ToHost[]
    acquireVsCodeApi: () => {
      postMessage: (message: ToHost) => void
      getState: () => unknown
      setState: (state: unknown) => void
    }
  }
}

let script: string

test.beforeAll(async () => {
  script = await bundleWebview()
})

function prompt(title: string, status: PromptView['status'], store: PromptView['store'] = 'global'): PromptView {
  return {
    id: title.toLowerCase().replaceAll(' ', '-'),
    title,
    body: `Full text of ${title}`,
    excerpt: `Full text of ${title}`,
    store,
    status,
    updatedAt: new Date().toISOString(),
    needsConfirmation: store === 'repo',
    inCurrentRepo: true,
    attachments: [],
    warnings: [],
  }
}

async function openSidebar(page: Page, state: ViewState, theme: string): Promise<void> {
  const colors = theme === 'light'
    ? { background: '#f3f3f3', foreground: '#24292f', muted: '#616161', input: '#fff', border: '#c8c8c8', icon: '#424242', link: '#005fb8', button: '#005fb8', buttonText: '#fff' }
    : theme === 'high-contrast'
      ? { background: '#000', foreground: '#fff', muted: '#fff', input: '#000', border: '#fff', icon: '#fff', link: '#00b7f4', button: '#000', buttonText: '#fff' }
      : { background: '#252526', foreground: '#ccc', muted: '#aaa', input: '#3c3c3c', border: '#555', icon: '#c5c5c5', link: '#4daafc', button: '#0e639c', buttonText: '#fff' }
  await page.setContent('<!doctype html><html lang="en"><body><div id="app"></div></body></html>')
  await page.addStyleTag({ path: fileURLToPath(new URL('../../../extension/src/webview/webview.css', import.meta.url)) })
  await page.addStyleTag({ content: `:root {
    --vscode-font-family: system-ui;
    --vscode-font-size: 13px;
    --vscode-foreground: ${colors.foreground};
    --vscode-descriptionForeground: ${colors.muted};
    --vscode-sideBar-background: ${colors.background};
    --vscode-panel-border: ${colors.border};
    --vscode-icon-foreground: ${colors.icon};
    --vscode-textLink-foreground: ${colors.link};
    --vscode-focusBorder: ${colors.link};
    --vscode-input-background: ${colors.input};
    --vscode-input-foreground: ${colors.foreground};
    --vscode-input-placeholderForeground: ${colors.muted};
    --vscode-button-background: ${colors.button};
    --vscode-button-foreground: ${colors.buttonText};
    --vscode-button-secondaryBackground: ${colors.input};
    --vscode-button-secondaryForeground: ${colors.foreground};
    --vscode-list-hoverBackground: ${colors.input};
    --vscode-toolbar-hoverBackground: ${colors.input};
    --vscode-editorInfo-foreground: ${colors.link};
  } html { background: ${colors.background}; }` })
  await page.evaluate(() => {
    window.capturedMessages = []
    window.acquireVsCodeApi = () => ({
      postMessage: message => { window.capturedMessages.push(message) },
      getState: () => undefined,
      setState: () => {},
    })
  })
  await page.addScriptTag({ content: script })
  await page.evaluate(next => window.postMessage({ type: 'state', state: next }, '*'), state)
  await expect(page.getByRole('region', { name: 'Parked prompts', exact: true })).toBeVisible()
}

test('sidebar rows show the saved model by name', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 220, height: 600 })
  const known = { ...prompt('Known model prompt', 'parked'), model: 'gpt-4o' }
  const missing = { ...prompt('Missing model prompt', 'draft'), model: 'retired-model' }
  const none = prompt('Default model prompt', 'parked')
  const state: ViewState = {
    prompts: [known, missing, none],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
    restoreTarget: 'newChat',
  }
  await openSidebar(page, state, testInfo.project.name)
  const row = (title: string) => page.getByRole('listitem').filter({ hasText: title })

  const chip = row('Known model prompt').locator('.model-chip')
  await expect(chip).toHaveText('Model: GPT-4o')
  await expect(chip.locator('svg')).toHaveCount(1)
  await expect(chip).toHaveAttribute('title', /GPT-4o \(gpt-4o\)\. Drafting in chat selects it\./)
  const unavailable = row('Missing model prompt').locator('.model-chip')
  await expect(unavailable).toHaveText('Model: retired-model')
  await expect(unavailable).toHaveAttribute('title', /not available here/)
  await expect(row('Default model prompt').locator('.model-chip')).toHaveCount(0)

  // The chip never pushes the title or the row's actions out of the narrow sidebar.
  const box = await row('Known model prompt').boundingBox()
  const chipBox = await chip.boundingBox()
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(box!.x + box!.width)
  await expect(row('Known model prompt').getByRole('button', { name: /^More actions/ })).toBeInViewport()

  await page.getByRole('searchbox', { name: 'Search parked prompts' }).fill('gpt-4o')
  await expect(row('Known model prompt')).toBeVisible()
  await expect(row('Default model prompt')).toHaveCount(0)
})

test('first-run tips show once and reopen from the info button', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 260, height: 700 })
  const state: ViewState = {
    prompts: [prompt('Saved prompt', 'parked')],
    problems: [],
    scope: 'repo',
    repoLabel: 'owner/repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
    showTips: true,
  }
  await openSidebar(page, state, testInfo.project.name)
  const tips = page.getByRole('region', { name: 'Tips for Parked Prompts' })
  const info = page.getByRole('button', { name: 'Tips and key features' })
  await expect(tips).toBeVisible()
  await expect(tips).toContainText('Draft in chat.')
  await expect(tips).toContainText(/(⌘⌥P|Ctrl\+Alt\+P)/)
  await expect(info).toHaveAttribute('aria-expanded', 'true')
  // It does not take focus or cover the composer.
  await expect(page.getByRole('textbox', { name: 'Prompt text' })).toBeInViewport()

  await tips.getByRole('button', { name: 'Got it' }).click()
  await expect(tips).toBeHidden()
  await expect(info).toBeFocused()
  await expect(info).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => window.capturedMessages.filter(message => message.type === 'dismissTips').length)).toBe(1)

  // The host now says they were seen, so a refresh leaves them closed.
  await page.evaluate(next => window.postMessage({ type: 'state', state: next }, '*'), { ...state, showTips: false })
  await expect(tips).toBeHidden()

  await info.click()
  await expect(tips).toBeVisible()
  await expect(tips.getByRole('heading', { name: 'Tips for Parked Prompts' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(tips).toBeHidden()
  await expect(info).toBeFocused()
  expect(await page.evaluate(() => window.capturedMessages.filter(message => message.type === 'dismissTips').length)).toBe(1)
})

test('sidebar repository labels show names and retain full labels', async ({ page }, testInfo) => {
  const here = { ...prompt('Current prompt', 'parked'), repoLabel: 'owner/repo' }
  const elsewhere = { ...prompt('Other prompt', 'parked'), repoLabel: 'another/repo', inCurrentRepo: false }
  const state: ViewState = {
    prompts: [here, elsewhere],
    problems: [],
    scope: 'all',
    repoLabel: 'owner/repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }
  await openSidebar(page, state, testInfo.project.name)
  const scope = page.getByRole('group', { name: 'Which prompts to show' })
  const currentRepo = scope.getByRole('button', { name: 'owner/repo', exact: true })
  await expect(currentRepo).toHaveText('repo')
  await expect(currentRepo).toHaveAttribute('title', 'owner/repo')
  await expect(currentRepo).toHaveAttribute('aria-pressed', 'false')
  await currentRepo.focus()
  await expect(currentRepo).toBeFocused()

  for (const [title, label] of [['Current prompt', 'owner/repo'], ['Other prompt', 'another/repo']] as const) {
    const row = page.getByRole('listitem').filter({ hasText: title })
    const repo = row.locator(`[title="${label}"]`)
    await expect(repo.locator('[aria-hidden="true"]')).toHaveText('repo')
    await expect(repo.locator('.sr-only')).toHaveText(label)
  }

  await page.getByRole('searchbox', { name: 'Search parked prompts' }).fill('another')
  await expect(page.getByRole('listitem').filter({ hasText: 'Other prompt' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Current prompt' })).toHaveCount(0)
  await page.evaluate(() => { window.capturedMessages = [] })
  await currentRepo.click()
  await expect.poll(() => page.evaluate(() => window.capturedMessages)).toEqual([{ type: 'setScope', scope: 'repo' }])

  await page.evaluate(next => window.postMessage({ type: 'state', state: next }, '*'), { ...state, repoLabel: 'Local Folder' })
  const localRepo = scope.getByRole('button', { name: 'Local Folder', exact: true })
  await expect(localRepo).toHaveText('Local Folder')
  await expect(localRepo).toHaveAttribute('title', 'Local Folder')
  const withoutRepo = { ...state }
  delete withoutRepo.repoLabel
  await page.evaluate(next => window.postMessage({ type: 'state', state: next }, '*'), withoutRepo)
  await expect(scope.getByRole('button', { name: 'No repo', exact: true })).toBeVisible()
})

test('long repository names fit a narrow sidebar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 220, height: 800 })
  const name = 'a-very-long-repository-name-that-needs-truncation'
  const label = `owner/${name}`
  await openSidebar(page, {
    prompts: [],
    problems: [],
    scope: 'repo',
    repoLabel: label,
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  const scope = page.getByRole('group', { name: 'Which prompts to show' })
  const currentRepo = scope.getByRole('button', { name: label, exact: true })
  await expect(currentRepo).toHaveText(name)
  await expect(currentRepo).toHaveAttribute('title', label)
  for (const control of [page.getByRole('searchbox', { name: 'Search parked prompts' }), currentRepo, scope.getByRole('button', { name: 'All', exact: true })]) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(220)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(220)
})

test('sidebar rows expose draft, edit, copy, and confirmed-delete actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 220, height: 800 })
  const state: ViewState = {
    prompts: [prompt('Draft item', 'draft'), prompt('Parked item', 'parked'), prompt('Shared item', 'parked', 'repo')],
    problems: [],
    scope: 'repo',
    repoLabel: 'owner/repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }
  await openSidebar(page, state, testInfo.project.name)
  await page.evaluate(() => { window.capturedMessages = [] })

  for (const title of ['Draft item', 'Parked item']) {
    const row = page.getByRole('listitem').filter({ hasText: title })
    for (const name of [`Draft in chat: ${title}`, `Edit: ${title}`, `Copy prompt text: ${title}`, `Delete: ${title}`]) {
      const button = row.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true')
      const bounds = await button.boundingBox()
      expect(bounds).not.toBeNull()
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(220)
      await button.click()
    }
  }

  const shared = page.getByRole('listitem').filter({ hasText: 'Shared item' })
  await expect(shared.getByRole('button', { name: 'Review and draft in chat: Shared item' })).toHaveAttribute('title', /Review before drafting/)
  await expect(shared.getByRole('button', { name: 'Copy prompt text: Shared item' })).toHaveAttribute('title', /Review before copying/)
  await shared.getByRole('button', { name: 'Copy prompt text: Shared item' }).click()
  expect(await page.evaluate(() => window.capturedMessages)).toEqual([
    { type: 'restore', ref: { id: 'draft-item', store: 'global' } },
    { type: 'edit', ref: { id: 'draft-item', store: 'global' } },
    { type: 'copy', ref: { id: 'draft-item', store: 'global' } },
    { type: 'delete', ref: { id: 'draft-item', store: 'global' } },
    { type: 'restore', ref: { id: 'parked-item', store: 'global' } },
    { type: 'edit', ref: { id: 'parked-item', store: 'global' } },
    { type: 'copy', ref: { id: 'parked-item', store: 'global' } },
    { type: 'delete', ref: { id: 'parked-item', store: 'global' } },
    { type: 'copy', ref: { id: 'shared-item', store: 'repo' } },
  ])
})

test('the Done group clears only the completed prompts that are shown', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 220, height: 600 })
  const state: ViewState = {
    prompts: [prompt('Old fix', 'done'), prompt('Old docs', 'done', 'repo'), prompt('Still parked', 'parked')],
    problems: [],
    scope: 'all',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }
  await openSidebar(page, state, testInfo.project.name)
  await page.evaluate(() => { window.capturedMessages = [] })

  const sweep = page.getByRole('button', { name: 'Clear done', exact: true })
  await expect(sweep).toHaveAttribute('title', 'Clear shown completed prompts')
  await expect(sweep.locator('svg')).toHaveAttribute('aria-hidden', 'true')
  const bounds = await sweep.boundingBox()
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(220)
  // The button sits beside the collapsed group, so clicking it does not expand it.
  await sweep.click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Old fix' })).toBeHidden()

  await page.getByRole('searchbox', { name: 'Search parked prompts' }).fill('docs')
  await sweep.click()
  expect(await page.evaluate(() => window.capturedMessages)).toEqual([
    { type: 'clearDone', scope: 'all', refs: [{ id: 'old-fix', store: 'global' }, { id: 'old-docs', store: 'repo' }] },
    { type: 'clearDone', scope: 'all', refs: [{ id: 'old-docs', store: 'repo' }] },
  ])

  await page.getByRole('searchbox', { name: 'Search parked prompts' }).fill('parked')
  await expect(sweep).toHaveCount(0)
})

test('draft-in-chat describes the configured current-chat target', async ({ page }, testInfo) => {
  await openSidebar(page, {
    prompts: [prompt('Current', 'parked')],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'currentChat',
  }, testInfo.project.name)
  await expect(page.getByRole('button', { name: 'Draft in chat: Current' })).toHaveAttribute('title', 'Draft in the current chat. It is not sent.')
})

test('the sidebar Park button stays anchored as save status changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 220, height: 800 })
  await openSidebar(page, {
    prompts: [],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [{ id: 'long-model', label: 'A model with a long display name' }],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  const composer = page.getByRole('region', { name: 'New prompt' })
  const park = composer.getByRole('button', { name: 'Park', exact: true })
  await composer.getByRole('textbox', { name: 'Prompt text', exact: true }).fill('Keep this prompt')
  const initial = await park.boundingBox()
  if (!initial) throw new Error('The Park button is not visible')

  await expect.poll(() => page.evaluate(() => window.capturedMessages.some(message => message.type === 'saveDraft'))).toBe(true)
  const save = (await page.evaluate(() => window.capturedMessages)).find(message => message.type === 'saveDraft')
  if (!save || save.type !== 'saveDraft') throw new Error('The draft was not saved')
  await page.evaluate(requestId => window.postMessage({ type: 'saved', requestId, id: 'stable-draft' }, '*'), save.requestId)
  await expect(composer.getByRole('status')).toHaveText('Draft saved')
  await expect(composer.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  expect(await park.boundingBox()).toEqual(initial)

  await page.evaluate(() => { window.capturedMessages = [] })
  await composer.getByRole('textbox', { name: 'Prompt text', exact: true }).fill('Keep the update')
  await expect.poll(() => page.evaluate(() => window.capturedMessages.some(message => message.type === 'saveDraft'))).toBe(true)
  const update = (await page.evaluate(() => window.capturedMessages)).find(message => message.type === 'saveDraft')
  if (!update || update.type !== 'saveDraft') throw new Error('The update was not saved')
  const message = `Could not write the draft to ${'a-long-path-'.repeat(12)}. Check the folder permissions and try again.`
  await page.evaluate(({ requestId, message }) => window.postMessage({ type: 'failed', requestId, message }, '*'), { requestId: update.requestId, message })
  await expect(composer.getByRole('status')).toHaveText(`Not saved: ${message}`)
  expect(await park.boundingBox()).toEqual(initial)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(220)
})

for (const [label, action] of [
  ['Copy prompt text: Draft item', 'copy'],
  ['Draft in chat: Draft item', 'restore'],
  ['Delete: Draft item', 'delete'],
] as const) {
  test(`${action} waits for the current draft to save`, async ({ page }, testInfo) => {
    const draft = prompt('Draft item', 'draft')
    await openSidebar(page, {
      prompts: [draft],
      problems: [],
      scope: 'repo',
      trusted: true,
      isGitRepo: true,
      models: [],
      restoreTarget: 'newChat',
    }, testInfo.project.name)
    await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
    await expect(page.getByRole('textbox', { name: 'Prompt text', exact: true })).toHaveValue(draft.body)
    await page.evaluate(() => { window.capturedMessages = [] })
    await page.getByRole('textbox', { name: 'Prompt text', exact: true }).fill('Newest draft text')
    await page.getByRole('button', { name: label }).click()

    await expect.poll(async () => page.evaluate(() => window.capturedMessages.map(message => message.type))).toContain('saveDraft')
    const messages = await page.evaluate(() => window.capturedMessages)
    expect(messages.map(message => message.type)).toEqual(['saveDraft'])
    const save = messages.find(message => message.type === 'saveDraft')
    if (!save || save.type !== 'saveDraft') throw new Error('The draft was not saved')
    expect(save).toMatchObject({ id: draft.id, body: 'Newest draft text' })
    await page.evaluate(({ requestId, id }) => window.postMessage({ type: 'saved', requestId, id }, '*'), { requestId: save.requestId, id: draft.id })
    await expect.poll(async () => page.evaluate(() => window.capturedMessages.map(message => message.type))).toEqual(['saveDraft', action])
  })
}

test('a failed draft save prevents copying and keeps the text', async ({ page }, testInfo) => {
  const draft = prompt('Draft item', 'draft')
  await openSidebar(page, {
    prompts: [draft],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
  await expect(page.getByRole('textbox', { name: 'Prompt text', exact: true })).toHaveValue(draft.body)
  await page.evaluate(() => { window.capturedMessages = [] })
  await page.getByRole('textbox', { name: 'Prompt text', exact: true }).fill('Keep this unsaved text')
  await page.getByRole('button', { name: 'Copy prompt text: Draft item' }).click()
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.some(message => message.type === 'saveDraft'))).toBe(true)
  const messages = await page.evaluate(() => window.capturedMessages)
  const save = messages.find(message => message.type === 'saveDraft')
  if (!save || save.type !== 'saveDraft') throw new Error('The draft was not saved')
  await page.evaluate(requestId => window.postMessage({ type: 'failed', requestId, message: 'Disk full' }, '*'), save.requestId)
  await expect(page.getByRole('status').filter({ hasText: 'Not saved: Disk full' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Prompt text', exact: true })).toHaveValue('Keep this unsaved text')
  expect((await page.evaluate(() => window.capturedMessages)).some(message => message.type === 'copy')).toBe(false)
})

test('copy also waits for text entered while a draft save is in flight', async ({ page }, testInfo) => {
  const draft = prompt('Draft item', 'draft')
  await openSidebar(page, {
    prompts: [draft],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
  const text = page.getByRole('textbox', { name: 'Prompt text', exact: true })
  await expect(text).toHaveValue(draft.body)
  await page.evaluate(() => { window.capturedMessages = [] })
  await text.fill('First change')
  await page.getByRole('button', { name: 'Copy prompt text: Draft item' }).click()
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.filter(message => message.type === 'saveDraft').length)).toBe(1)
  const first = (await page.evaluate(() => window.capturedMessages)).find(message => message.type === 'saveDraft')
  if (!first || first.type !== 'saveDraft') throw new Error('The first save was not requested')

  await text.fill('Text entered while saving')
  await page.evaluate(({ requestId, id }) => window.postMessage({ type: 'saved', requestId, id }, '*'), { requestId: first.requestId, id: draft.id })
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.filter(message => message.type === 'saveDraft').length)).toBe(2)
  const messages = await page.evaluate(() => window.capturedMessages)
  expect(messages.map(message => message.type)).toEqual(['saveDraft', 'saveDraft'])
  const second = messages[1]
  if (!second || second.type !== 'saveDraft') throw new Error('The newer text was not saved')
  expect(second.body).toBe('Text entered while saving')
  await page.evaluate(({ requestId, id }) => window.postMessage({ type: 'saved', requestId, id }, '*'), { requestId: second.requestId, id: draft.id })
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.map(message => message.type))).toEqual(['saveDraft', 'saveDraft', 'copy'])
})

test('parking waits for text entered while the draft is saving', async ({ page }, testInfo) => {
  const draft = prompt('Draft item', 'draft')
  await openSidebar(page, {
    prompts: [draft],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
  const text = page.getByRole('textbox', { name: 'Prompt text', exact: true })
  await expect(text).toHaveValue(draft.body)
  await page.evaluate(() => { window.capturedMessages = [] })
  await text.fill('First change')
  await page.getByRole('button', { name: 'Park', exact: true }).click()
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.filter(message => message.type === 'saveDraft').length)).toBe(1)
  const first = (await page.evaluate(() => window.capturedMessages)).find(message => message.type === 'saveDraft')
  if (!first || first.type !== 'saveDraft') throw new Error('The first save was not requested')

  await text.fill('Text entered while saving')
  await page.evaluate(({ requestId, id }) => window.postMessage({ type: 'saved', requestId, id }, '*'), { requestId: first.requestId, id: draft.id })
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.filter(message => message.type === 'saveDraft').length)).toBe(2)
  const messages = await page.evaluate(() => window.capturedMessages)
  expect(messages.map(message => message.type)).toEqual(['saveDraft', 'saveDraft'])
  const second = messages[1]
  if (!second || second.type !== 'saveDraft') throw new Error('The newer text was not saved')
  expect(second.body).toBe('Text entered while saving')
  await page.evaluate(({ requestId, id }) => window.postMessage({ type: 'saved', requestId, id }, '*'), { requestId: second.requestId, id: draft.id })
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.map(message => message.type))).toEqual(['saveDraft', 'saveDraft', 'park'])
  await expect(text).toHaveValue('')
})

test('reopening the current prompt does not replace newer text with a stale snapshot', async ({ page }, testInfo) => {
  const draft = prompt('Draft item', 'draft')
  await openSidebar(page, {
    prompts: [draft],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
  const text = page.getByRole('textbox', { name: 'Prompt text', exact: true })
  await expect(text).toHaveValue(draft.body)
  await page.evaluate(() => { window.capturedMessages = [] })
  await text.fill('Newer text')
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.some(message => message.type === 'saveDraft'))).toBe(true)
  const save = (await page.evaluate(() => window.capturedMessages)).find(message => message.type === 'saveDraft')
  if (!save || save.type !== 'saveDraft') throw new Error('The draft was not saved')
  await page.evaluate(({ requestId, id }) => window.postMessage({ type: 'saved', requestId, id }, '*'), { requestId: save.requestId, id: draft.id })
  await expect(text).toHaveValue('Newer text')
})

test('a failed save does not replace the composer when editing another prompt', async ({ page }, testInfo) => {
  const draft = prompt('Draft item', 'draft')
  const other = prompt('Other item', 'parked')
  await openSidebar(page, {
    prompts: [draft, other],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
  const text = page.getByRole('textbox', { name: 'Prompt text', exact: true })
  await expect(text).toHaveValue(draft.body)
  await page.evaluate(() => { window.capturedMessages = [] })
  await text.fill('Do not lose this')
  await page.getByRole('button', { name: 'Edit: Other item' }).click()
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.some(message => message.type === 'edit'))).toBe(true)
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), other)
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.some(message => message.type === 'saveDraft'))).toBe(true)
  const save = (await page.evaluate(() => window.capturedMessages)).find(message => message.type === 'saveDraft')
  if (!save || save.type !== 'saveDraft') throw new Error('The draft was not saved')
  await page.evaluate(requestId => window.postMessage({ type: 'failed', requestId, message: 'Disk full' }, '*'), save.requestId)
  await expect(page.getByRole('status').filter({ hasText: 'Not saved: Disk full' })).toBeVisible()
  await expect(text).toHaveValue('Do not lose this')
  await page.evaluate(() => window.postMessage({ type: 'newPrompt' }, '*'))
  await expect(text).toHaveValue('Do not lose this')
})

test('does not redirect a delete when an edited draft is recreated', async ({ page }, testInfo) => {
  const draft = prompt('Draft item', 'draft')
  await openSidebar(page, {
    prompts: [draft],
    problems: [],
    scope: 'repo',
    trusted: true,
    isGitRepo: true,
    models: [],
    restoreTarget: 'newChat',
  }, testInfo.project.name)
  await page.evaluate(value => window.postMessage({ type: 'load', prompt: value }, '*'), draft)
  const text = page.getByRole('textbox', { name: 'Prompt text', exact: true })
  await expect(text).toHaveValue(draft.body)
  await page.evaluate(() => { window.capturedMessages = [] })
  await text.fill('Keep this draft')
  await page.getByRole('button', { name: 'Delete: Draft item' }).click()
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.filter(message => message.type === 'saveDraft').length)).toBe(1)
  const first = (await page.evaluate(() => window.capturedMessages)).find(message => message.type === 'saveDraft')
  if (!first || first.type !== 'saveDraft') throw new Error('The original save was not requested')
  await page.evaluate(requestId => window.postMessage({ type: 'failed', requestId, code: 'not_found', message: 'Gone' }, '*'), first.requestId)
  await expect.poll(async () => page.evaluate(() => window.capturedMessages.filter(message => message.type === 'saveDraft').length)).toBe(2)
  const second = (await page.evaluate(() => window.capturedMessages)).filter(message => message.type === 'saveDraft')[1]
  if (!second || second.type !== 'saveDraft') throw new Error('The replacement draft was not requested')
  expect(second).not.toHaveProperty('id')
  await page.evaluate(requestId => window.postMessage({ type: 'saved', requestId, id: 'new-draft' }, '*'), second.requestId)
  await expect(page.getByRole('status').filter({ hasText: 'The current draft changed' })).toBeVisible()
  await expect(text).toHaveValue('Keep this draft')
  expect((await page.evaluate(() => window.capturedMessages)).some(message => message.type === 'delete')).toBe(false)
})
