# Copilot instructions

Read [CONTRIBUTING.md](../CONTRIBUTING.md), especially "Rules worth keeping". Those rules protect users, so do not relax them to make a change easier.

- Every pull request adds an entry under `## Unreleased` in the root `CHANGELOG.md`, following "Changelog" in CONTRIBUTING.md. Add the PR link once the PR exists. Never invent a version heading: those are added after a release publishes.
- Run `pnpm check` before finishing. For canvas changes, also run `pnpm --filter parked-prompts-canvas build && pnpm e2e`.
- The website in `site/` is plain HTML, CSS, and JavaScript with a strict Content-Security-Policy, so no inline scripts or styles. `pnpm check:site` also checks that its docs match the extension's commands and settings.
- VS Code's internal chat commands are only called from `packages/extension/src/chatAdapter.ts`.
- `packages/core` must not depend on `vscode`.
