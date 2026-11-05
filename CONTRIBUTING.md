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
site                The website, as plain HTML, CSS, and JavaScript. No build step.
tools/phase0        Re-checks VS Code's internal behavior against a new build.
tools/setup-repo.sh One-time repository setup for releases and the website.
docs                Phase 0 results.
```

## Tests

| Command | What it runs | Notes |
|---|---|---|
| `pnpm check` | Build, typecheck, lint, all unit tests, and the website check | Run this before a pull request |
| `pnpm e2e` | Canvas browser tests in light, dark, and high contrast | Needs a build first |
| `pnpm test:vscode` | Smoke tests inside real VS Code | Downloads Insiders, or set `VSCODE_EXECUTABLE`. Use `xvfb-run -a` on Linux |

To work on the website, run `pnpm preview:site`. It serves `site/` under `/parked-prompts/`, the same path as GitHub Pages.

Write a failing test first when you fix a bug. Put new store behavior in core with a unit test, rather than in one of the surfaces.

## Changelog

Every pull request adds an entry to [CHANGELOG.md](CHANGELOG.md), under `## Unreleased` at the top:

```md
- **Area:** what changed, from the user's point of view. ([#12](https://github.com/jamesmontemagno/parked-prompts/pull/12))
```

- Use an area that already appears there where one fits, such as **Canvas**, **Editor extension**, **Website**, or **Releases**.
- Use a full link to the pull request. GitHub does not turn `#12` into a link inside a file.
- Changes with nothing to say to users, like CI or test tweaks, still get a short line under **Maintenance**.
- Never add a version heading yourself. Versions are `1.0.<run number>`, so nobody knows the number until a release publishes. [RELEASING.md](RELEASING.md#after-publishing) covers moving the entries.

[`packages/extension/CHANGELOG.md`](packages/extension/CHANGELOG.md) only links here, because it ships in the package and appears on the Marketplace. Don't add entries to it.

## Rules worth keeping

These protect users, so please keep them true:

- **Restoring never sends.** `isPartialQuery: true` and `prefillPrompt: true` are what guarantee it, and tests pin both down. All chat commands stay in `chatAdapter.ts`.
- **The agent cannot send.** Anything that sends or arms is `expose: 'ui'` in the canvas.
- **Repo prompts are untrusted.** They are confirmed by content hash before use, and that check runs again at the moment of sending.
- **Publishing stores no token.** It uses Trusted Publishing, and only the publishing jobs in `publish.yml` have `id-token: write`. They run no build or tests, and `vsce` comes from the lockfile. `publishing.test.ts` runs that exact command against a stand-in Marketplace and enforces all of this.
- **Nothing is published without a check of what is in it.** `verify-vsix.mts` holds the exact file list for the package, so anything new has to be added on purpose.
- **Never put prompt text in the DOM as markup.** The webview builds elements with `textContent`, and its Content-Security-Policy stays strict.
- **A path from a prompt file or a page is never trusted.** Use `normalizeRelativePath`, `resolveInside`, and `realpathInside`.
- **Reading a repository doesn't run Git.** `readRepoInfo` parses the files, because a repository's config can make Git run commands. Git only runs for a worktree, in a trusted workspace, after the user confirms.
- **Core has no `vscode` dependency**, so the canvas can use it.

## When VS Code changes

If a new Insiders build breaks restore, run [`tools/phase0`](tools/phase0) to see which assumption moved. Update `chatAdapter.ts` and [the results](docs/spike-results.md) together.

## Releasing

See [RELEASING.md](RELEASING.md).
