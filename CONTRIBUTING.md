# Contributing

## Setup

You need Node.js 24 and pnpm (`corepack enable` picks the pinned version).

```sh
pnpm install
pnpm build
```

For the browser tests, run `pnpm --filter parked-prompts-canvas playwright:install` once.

## The layout

```text
packages/core       Store format, attachments, repo matching. No vscode dependency.
packages/extension  The VS Code extension. src/webview is the sidebar page.
packages/canvas     The Copilot canvas, built with canvas-kit.
tools/phase0        Re-checks VS Code's internal behavior against a new build.
docs                Phase 0 results.
```

## Tests

| Command | What it runs | Notes |
|---|---|---|
| `pnpm check` | Build, typecheck, lint, all unit tests | Run this before a pull request |
| `pnpm e2e` | Canvas browser tests in light, dark, and high contrast | Needs a build first |
| `pnpm test:vscode` | Smoke tests inside real VS Code | Downloads Insiders, or set `VSCODE_EXECUTABLE`. Use `xvfb-run -a` on Linux |

Write a failing test first when you fix a bug. Put new store behavior in core with a unit test, rather than in one of the surfaces.

## Rules worth keeping

These protect users, so please keep them true:

- **Restoring never sends.** `isPartialQuery: true` and `prefillPrompt: true` are what guarantee it, and tests pin both down. All chat commands stay in `chatAdapter.ts`.
- **The agent cannot send.** Anything that sends or arms is `expose: 'ui'` in the canvas.
- **Repo prompts are untrusted.** They are confirmed by content hash before use, and that check runs again at the moment of sending.
- **Never put prompt text in the DOM as markup.** The webview builds elements with `textContent`, and its Content-Security-Policy stays strict.
- **A path from a prompt file or a page is never trusted.** Use `normalizeRelativePath`, `resolveInside`, and `realpathInside`.
- **Reading a repository doesn't run Git.** `readRepoInfo` parses the files, because a repository's config can make Git run commands. Git only runs for a worktree, in a trusted workspace, after the user confirms.
- **Core has no `vscode` dependency**, so the canvas can use it.

## When VS Code changes

If a new Insiders build breaks restore, run [`tools/phase0`](tools/phase0) to see which assumption moved. Update `chatAdapter.ts` and [the results](docs/spike-results.md) together.

## Releasing

- **Canvas:** every push to `main` publishes to the `stable` branch through `.github/workflows/publish.yml`.
- **Extension:** `pnpm package:vsix` builds a VSIX to test. Publishing to the Marketplace is a separate step that needs the maintainer's approval.
