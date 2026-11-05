# Phase 0 results

Each check from [the plan](../PLAN.md), run on real builds rather than inferred from source.

**Tested on:** VS Code Insiders 1.146.0 (`69176e5c`), Linux x64, under Xvfb, signed out, driving the real UI over the Chrome DevTools Protocol. The harness is in [`tools/phase0`](../tools/phase0), so these can be re-run on a new build.

| Status | Meaning |
|---|---|
| ✅ Proven | Run on the real build and observed |
| ⚠️ Partly | Part proven, part changed the design |
| ❌ Failed | Run and it does not work, so the fallback applies |
| 🔲 Not proven | Could not be run here. Needs a signed-in session; see [what is left](#what-is-left-for-you-to-run) |

## Summary

| | Check | Result | What it changed |
|---|---|---|---|
| A | `chat.open` fills the Chat view input, images included | ✅ Proven | Restore works as planned |
| B | The same in the Agents window | ❌ Failed, with a better fallback | Separate restore path, text only |
| C | `newChat` then `chat.open` lands in the new chat | ✅ Proven | New chat is the default target |
| D | Read the chat input, and identify the focused one | ⚠️ Partly | Readable, but focus is unknown |
| E | The `chat/input/status` button renders and can be invoked | ❌ Renders, cannot be invoked | Off by default; keybinding instead |
| F | Canvas: paste, pick files, `session.send` with attachments | ⚠️ Partly | Attachments also listed by path |
| G | `session.idle` and `mode: "enqueue"` for send-when-idle | 🔲 Not proven live | Unit and browser tested against the kit's harness |
| H | Session creation with `cwd` from an SDK extension | ❌ Not available | Worktree flow opens a new window, as planned |
| I | `extensions.supportAgentsWindow`, and other ways to enable | ✅ Proven, better than planned | No setting needed |
| J | `/park` capture through `user.message` and `session.abort()` | Left out | Attachments go in through the composer |

## Details

### A. Restore in the Chat view: ✅

`workbench.action.chat.open` with `{ query, isPartialQuery: true, attachFiles }` filled the input and sent nothing. In the DOM afterwards:

```text
Attached file, sample.ts /tmp/spike/ws/src (Delete)
Attached file, sample.ts /tmp/spike/ws/src, line 1 to line 2 (Delete)
Attached image, shot.png (Delete)
```

Plain `Uri`s and `{ uri, range }` both work, and images are attached as images. Behaviour to design around:

- **A second partial query replaces the text but keeps the earlier attachments**, so attachments pile up in the current chat. This is why a new chat is the default.
- **An attachment that no longer exists is skipped silently**, so core flags missing files first.
- **An image leaves a `U+FFFC` character in the input's text.** Capture strips it.

### B. The Agents window: ❌ (text only through another command)

`workbench.action.chat.open` is registered there and returns successfully, but it **does nothing**: the composer stayed empty, both with no session and after one was prefilled.

`workbench.action.sessions.newChat` works, and only exists in that window, which is how the extension recognizes it:

```ts
{ prompt: 'text', prefillPrompt: true }
```

Two things to know:

- **`prefillPrompt` is a boolean, and leaving it out sends the prompt.** The code path is `prefillPrompt ? prefillInput(prompt) : sendQuery(prompt)`. A unit test pins this down.
- It takes no attachments. So the prompt text lists each file by absolute path, and a notification says so. The canvas is the better route there.

### C. New chat then restore: ✅

Awaiting `workbench.action.chat.newChat` and then `chat.open` landed in the new chat with its attachments. Attachments from the old chat were gone.

### D. Reading what was typed: ⚠️

- **Readable:** the input is in `workspace.textDocuments` with scheme `chatSessionInput`, and its text updates live as you type. The Agents window composer uses the same scheme.
- **Focus is unknown:** `window.activeTextEditor` stays `undefined` even with the chat input focused, and a second chat adds `input-1` beside `input-0`.
- **So:** the extension uses the input edited last, treats inputs with identical text as one (a new chat copies the draft), and asks with a quick pick when it still cannot tell.

### E. The chat input button: ❌

The button renders in the Chat view and in chat editors. **Clicking it does nothing, with no error shown.** Hooking `JSON.stringify` during a real mouse click caught why:

```text
Converting circular structure to JSON
  --> starting at object with constructor 'z4i'
  |     property 'policyConfiguration' -> object with constructor 'Wft'
  ...
```

The toolbar sets `context = { widget }` with `shouldForwardArgs: true`, so the live `ChatWidget` is passed to the command, and that cannot cross to the extension host. **This affects every extension command in that menu.** It looks like a VS Code bug worth reporting.

The fallback from the plan applies:

- `Ctrl+Alt+P` / `Cmd+Alt+P` with `when: inChatInput`, verified from a focused chat input
- The Command Palette and the view's title actions
- The button stays in the manifest behind `parkedPrompts.experimental.chatInputButton`, off by default, ready for when this is fixed

### F. Canvas attachments: ⚠️

Proven in Chromium against the built plugin, under its real Content-Security-Policy, in light, dark, and high contrast:

- A pasted image is stored and shown
- A 3 MB picked file arrives whole, in chunks, because the host limits one request to 1 MiB

The plugin also installs into the real Copilot CLI, through a local marketplace folder.

**Not proven: a live `session.send` carrying `attachments`.** `AgentMessage` in canvas-kit does not declare the field, but both the kit and the SDK pass it through. So the canvas does both: it sends `attachments`, and lists the paths in the text, which is the plan's fallback.

### G. Send when idle: 🔲

Behaviour is tested against canvas-kit's real host with session events: it holds while busy, waits for a short grace period, sends one prompt per idle, waits for that turn to finish, and gives up on a missing idle event after 10 minutes. No real agent has been idle at it yet.

### H. Session creation from an extension: ❌

`joinSession` only joins the current session. Creating one with a `cwd` is on `CopilotClient`, which an extension in VS Code cannot reach. The worktree flow opens a new window, which [works end to end](#end-to-end-runs).

### I. Enabling in the Agents window: ✅

The plan expected a required user setting. There is a better way, declared by the extension:

```json
"capabilities": { "agentsWindow": { "supported": true } }
```

With this and no setting, the extension activated there and its commands ran. `extensions.supportAgentsWindow` still overrides it. Views do not appear in that window, so it uses quick picks and input boxes.

### J. `/park` capture: left out

This was optional, and it would need a signed-in session to test. Attachments go in through the composer.

## End-to-end runs

On Insiders 1.146 with the packaged VSIX:

- **Composer:** typing saves a draft, pasting an image shows a thumbnail under the strict CSP, and Park files it
- **Restore:** text, a `line 1 to line 3` file range, and an image all arrive in a new chat, unsent
- **Repo prompt:** Review opens a read-only preview and a modal. Nothing reaches chat until it is accepted
- **Worktree:** creates the branch and folder, opens a second window, and that window restores the prompt into a new chat, once. The first checkout stays on its branch
- **Agents window:** the composer is prefilled with file paths listed, unsent, and a notice explains why

## In CI

Every pull request runs the unit tests on Linux, Windows, and macOS, the browser tests, and the smoke suite inside both Insiders and stable VS Code. The smoke suite passes on stable, so `engines.vscode` does not need to target Insiders.

## What is left for you to run

These need a signed-in Copilot session, which this environment could not reach.

1. **G, live:** open the canvas in a session, start a long task, press **When idle** on a prompt, and confirm it sends once when the agent finishes.
2. **F, live:** press **Send** on a prompt with an image and a file range. Check whether the agent receives them as attachments, as well as paths in the text.
3. **Canvas in both windows:** open it in the editor's Chat and in the Agents window.
4. **Pasting from the OS clipboard:** the tests paste through a synthetic event, so try a real screenshot in the extension and in the canvas.
5. **macOS and Windows, by hand:** CI runs the unit tests on all three, but the end-to-end runs above were on Linux. Check the `Cmd+Alt+P` binding, and restoring on Windows.

## Notes for re-running

- Chromium's font service needs `/dev/shm`, and small containers crash the renderer with `No space left on device`. Pass `--disable-dev-shm-usage`.
- Native dialogs are not in the DOM on Linux. Set `"window.dialogStyle": "custom"` to drive them.
