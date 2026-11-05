# Copilot instructions

Read [CONTRIBUTING.md](../CONTRIBUTING.md), especially "Rules worth keeping". Those rules protect users, so do not relax them to make a change easier.

- Run `pnpm check` before finishing. For canvas changes, also run `pnpm --filter parked-prompts-canvas build && pnpm e2e`.
- VS Code's internal chat commands are only called from `packages/extension/src/chatAdapter.ts`.
- `packages/core` must not depend on `vscode`.
