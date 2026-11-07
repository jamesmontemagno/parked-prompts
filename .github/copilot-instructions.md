# Copilot instructions

Read [CONTRIBUTING.md](../CONTRIBUTING.md), especially "Rules worth keeping". Those rules protect users, so do not relax them to make a change easier.

- Every pull request adds an entry under `## Unreleased` in the root `CHANGELOG.md`, following "Changelog" in CONTRIBUTING.md. Add the PR link once the PR exists. Never invent a version heading: those are added after a release publishes.
- Run `pnpm check` before finishing. For canvas changes, also run `pnpm --filter parked-prompts-canvas build && pnpm e2e`.
- The website in `site/` is plain HTML, CSS, and JavaScript with a strict Content-Security-Policy, so no inline scripts or styles. `pnpm check:site` also checks that its docs match the extension's commands and settings.
- VS Code's internal chat commands are only called from `packages/extension/src/chatAdapter.ts`.
- `packages/core` must not depend on `vscode`.

## Two surfaces, one store

Parked Prompts ships two user interfaces over the same store in `packages/core`:

- **VS Code extension** (`packages/extension`): the sidebar webview in `src/webview` (`main.ts`, `list.ts`, `composer.ts`, `webview.css`) talks to the extension host over `src/protocol.ts`. Host actions live in `src/actions.ts`, chat restore in `src/chatAdapter.ts`, and the webview's Content-Security-Policy in `src/view.ts`. Restore fills the VS Code chat box without sending.
- **Copilot canvas** (`packages/canvas/canvases/parked-prompts`): a canvas-kit panel in the GitHub Copilot app. `App.tsx` and `Composer.tsx` are the UI, `canvas.ts` holds its actions, and shared UI pieces such as icons are in `packages/canvas/ui`. The canvas sends or queues prompts to the agent; it cannot read or fill the app's chat box.

### Feature parity

Treat every feature and UI change as a change to both surfaces unless a host limitation makes that impossible.

- Put behavior in `packages/core` first, with a unit test, so both surfaces call the same code. Don't duplicate store logic in a surface.
- Match the user-facing result: the same actions, labels, icons, confirmations, and safety checks (for example, confirm before deleting and skip prompts that changed since the user looked).
- Follow each host's conventions for the details: `--vscode-*` theme variables and the SVG icons built in `src/webview/dom.ts` for the sidebar, canvas-kit components and the icons in `packages/canvas/ui/icons.tsx` for the canvas. Keep the two icon sets visually matched, and make both work in light, dark, and high contrast.
- If one surface can't support a feature, say so in the pull request, the `CHANGELOG.md` entry, and the docs (`README.md`, `site/docs`, `site/integrations`), rather than shipping it silently on one side. Known gaps: only the extension can restore into a chat box, and only the canvas can send, queue, or send when the agent is idle.
- Cover both surfaces in tests: core unit tests, `canvas.spec.ts` for the canvas, and `editor-webview.spec.ts` plus `packages/extension/test` for the sidebar. `pnpm e2e` runs both browser suites.
- Write separate changelog lines under **Canvas** and **Editor extension** when both change.
