# Parked Prompts (working name): save chat prompts for later

## Problem and approach

Prompts often can't run right away because other agents are working in the same codebase. They need to be saved with their files and images, without being sent, then restored later in the editor Chat view or the Agents window.

VS Code has no API for reading the chat input or its attachments. So the stash is the source of truth and has its own composer. Chat is where prompts get restored to, and capturing from chat is a text-only extra.

Evidence comes from VS Code `main`, the installed Insiders 1.146 bundles and current docs. None of it has been run yet, so Phase 0 proves it before anything is built on it.

## Deliverables

```
packages/core       Store format, attachments, repo matching. No vscode dependency. Unit tested.
packages/extension  VS Code extension for the editor, with commands that also work in the Agents window.
packages/canvas     Copilot SDK canvas packaged as an agent plugin, for sessions in both windows.
```

The canvas can't ship through the VS Code Marketplace, so it's distributed as an agent plugin. Both pieces read the same on-disk store, so they don't need to talk to each other.

## Insiders vs Marketplace

| | Marketplace (stable APIs) | Insiders-only VSIX (proposed APIs) |
|---|---|---|
| Reach and updates | Anyone can install, auto-updates | Manual VSIX plus an `argv.json` setting per machine |
| API risk | Stable contracts | Proposals can change in any Insiders build |
| Extra capability | Input button, restore, webview, stable commands | `chatStatusItem`, `chatInputNotification`, active session resource, session provider menus |
| Reads chat attachments | No | **Also no** |

**Decision: stable APIs only, tested on Insiders by VSIX, and publish that same code later.** The proposed APIs don't solve the hard problem, and using them would mean rework before publishing.

Two caveats:
- Capturing typed text uses an undocumented document scheme. It's allowed but could break, so it stays optional and must fail cleanly.
- `engines.vscode` may have to target Insiders until the required behaviour reaches stable.

## Phase 0: prove the risky assumptions

Each check has a fallback, so a failure changes the design instead of blocking it.

| Check | Fallback |
|---|---|
| A. `chat.open` with `isPartialQuery` and `attachFiles` fills the input, images included, in the Chat view | Stop and rethink restore; the whole design depends on this |
| B. The same call in the Agents window, for both an existing chat and the new-session composer | Restore through the canvas (`session.send`), else copy to clipboard and reveal the files |
| C. `newChat` followed by `chat.open` lands in the new chat | Restore into the current chat with the overwrite guard |
| D. The `chatSessionInput` document is visible to extensions and the focused input can be identified | Drop "stash what I typed"; the composer still covers everything |
| E. The `chat/input/status` button renders in each surface and its command can be invoked | Command palette, keybinding and view title actions |
| F. Canvas in both windows: paste images, pick files, `session.send` with file and blob attachments | Attach images by path in the prompt text |
| G. `session.idle` and `mode: "enqueue"` behave as expected for send-when-idle | Queue into the current session only, without idle detection |
| H. Whether session creation with `cwd` is available to an SDK extension in VS Code | Worktree flow opens a new window instead |
| I. `extensions.supportAgentsWindow` enables the extension and which commands work | Canvas is the only Agents window UI |
| J. Optional: `user.message` then `session.abort()` as a `/park` capture with attachments, including whether it uses a request | Leave out; attachments go in through the composer |

Results are recorded in `docs/spike-results.md`.

## Phase 1: core store

- **Global store:** `~/.parked-prompts/<id>/`, a home-folder location both the extension and the canvas can reach.
- **Repo store (opt-in, per prompt):** `.github/parked-prompts/<id>/`, which can be committed.
- **Layout:** `prompt.md` with frontmatter (title, timestamps, repo remote, workspace path, mode, model, status) plus `attachments/`.
- **Repo scoping:** match by normalized Git remote, then by path, so stashes survive re-clones and worktrees. An all-repos view reads across them.
- **Attachments:**
  - Images and files outside the workspace are copied in.
  - Workspace files are stored as relative references with optional line ranges, so they attach the current version. Missing ones are flagged at restore.
- **Safety:** atomic writes, attachment size limit, path traversal protection, and tolerance for bad or partial entries.

## Phase 2: editor extension

- **Composer and list:** a Parked Prompts view with auto-saving text, image paste, a file picker, drafts, search and per-repo filtering.
- **Quick capture:** parking the current selection or active file, plus "Park what I typed" (text only, if D passes) with a clear note that attachments can't be read.
- **Restore (Phase 0 A–C):**
  - Defaults to a new chat, because `chat.open` overwrites the current input.
  - Restoring into the current chat warns first when it can detect existing text.
  - Never sends.
  - Keeps the stash until the user marks it done, because the extension can't observe sending.
- **Input button:** "Park" on `chat/input/status`, if E passes.

## Phase 3: worktree flow

"Run in a worktree" lets a parked prompt start now without touching the busy checkout:

1. Confirm the branch name and location, then run `git worktree add`.
2. Write a one-time pending-restore marker to the store.
3. Open the worktree in a new window with `vscode.openFolder`.
4. On activation there, consume the marker and restore the prompt into a new chat, unsent.

This needs only stable APIs and keeps attachments. Worktrees are never deleted automatically.

## Phase 4: Agents window canvas

- SDK canvas with a local server (same shape as `james-hub`): the same list and composer, on `127.0.0.1` with a random per-launch token because it serves private screenshots.
- **Actions:** send to this session, queue in this session, and send when idle.
- Exposes canvas actions so an agent can list parked prompts.
- Packaged as an agent plugin and installable from Git or a local folder.

**Send when idle** is only available in the canvas, for Copilot harness sessions. Stable VS Code APIs can't see whether chat is busy, so the editor extension won't offer it. It's limited to the session the canvas belongs to, and the user arms it per prompt. Prompts from a repo store must be previewed and can't be armed until confirmed.

## Phase 5: shareable prompts and release

- **Git-shareable:** a per-prompt "Move to repo" action that lists exactly what will be committed and warns about screenshots and secrets.
- Prompts that arrive by Git are treated as untrusted content: previewed first and never auto-sent. Disable repo prompts in untrusted workspaces.
- README covering limits and the Agents window setting.
- VSIX build for testing, then Marketplace packaging as a separate step that needs your go-ahead.

## Testing

- **Core:** unit tests for store round trips, repo matching, attachment handling and bad data.
- **Extension:** `@vscode/test-electron` smoke tests for activation, commands and the restore call arguments.
- **Manual, on Insiders:** the Phase 0 matrix in both windows, because the chat UI can't be fully automated. Include restoring over an existing draft and pasted images.

## Limits to expect

- Attachments already in the chat input can't be captured, unless J proves workable.
- Canvases need the Copilot harness and an initialized session, and they don't work in Local, Claude or Codex sessions.
- Restore relies on the `workbench.action.chat.open` argument shape, which is widely used but is an internal interface. Keep it behind one adapter.
- The Agents window requires the user to enable the extension through a setting. Check whether it can be enabled any other way during spike I.

## Open items

- Final product name, publisher ID and store folder name.
