# Changelog

Newest first. Each pull request adds a line under **Unreleased**. After an extension release publishes, its lines move under that version. The canvas and the website go live when a change merges, but their lines still move with the next extension release.

## Unreleased

- **Editor extension:** clear the completed prompts currently shown using the sweep icon beside Done, with confirmation before deletion. Prompts that change while the dialog is open are kept. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Editor extension:** a short tips card opens the first time, explaining the key features. Reopen it from the info button. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** a short tips card opens the first time, explaining the key features. Reopen it from the info button. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Editor extension:** prompt rows show the saved model's icon and name, with its ID on hover, and search matches it. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** prompt rows show the model chosen in VS Code. Sending from the canvas still uses the session's model. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Editor extension:** keep Park and Discard together in a right-aligned footer so save messages cannot move or wrap the buttons. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** keep composer actions in a right-aligned footer, with status messages below instead of wrapping alongside the buttons. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** repository filters and prompt labels show the repo name, with the full owner and name on hover. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Editor extension:** repository filters and prompt labels show the repo name, with the full owner and name on hover. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Editor extension:** use row icons to draft a prompt in chat, edit it, copy its text, or delete it after confirmation. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** clear the completed prompts currently shown using the sweep action, with confirmation before deletion. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** prompt actions now use compact icons for Edit, Move to repo, Done, and Delete. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** switching to edit another prompt first saves the current draft, keeping it open if saving fails. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** a Copy button copies a prompt's text so you can paste it into the chat box and edit it before sending. The canvas can't fill the chat box itself. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Canvas:** publishing now increments the patch version when canvas files or the generated marketplace change, without bumping it for unrelated pushes. ([#10](https://github.com/jamesmontemagno/parked-prompts/pull/10))
- **Maintenance:** Copilot instructions now describe the canvas and the extension, and ask for feature parity between them. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))
- **Changelog:** every pull request now adds an entry here, and each release moves them under its version. ([#11](https://github.com/jamesmontemagno/parked-prompts/pull/11))

## 1.0.3 (2026-11-05)

- **Canvas:** a card-based design that works in light, dark, and high contrast. The header shows the logo and a status light, the composer is a single card that grows as you type, and each prompt is a card with clearer Send, Queue, and When idle buttons. ([#8](https://github.com/jamesmontemagno/parked-prompts/pull/8))
- **Modes:** removed the obsolete Agent, Ask, and Edit picker. A restored prompt no longer sets a mode, so you choose the agent and harness in VS Code. Prompts saved with a mode still restore, and their model is kept. ([#7](https://github.com/jamesmontemagno/parked-prompts/pull/7))
- **Plugin install:** a catalog on the default branch points to the published canvas, so you can add `jamesmontemagno/parked-prompts` without `#stable`. Existing installs keep working. ([#6](https://github.com/jamesmontemagno/parked-prompts/pull/6))
- **Releases:** the canvas no longer fails to publish when two pushes land close together, and tests check the catalog and both listings. ([#5](https://github.com/jamesmontemagno/parked-prompts/pull/5))

## 1.0.2 (2026-11-05)

- **Install buttons:** for VS Code and VS Code Insiders, in the README and on the website. ([#3](https://github.com/jamesmontemagno/parked-prompts/pull/3))
- **Dependencies:** updated esbuild, mocha, and `@vscode/test-electron`. Dependabot no longer suggests `@types/vscode` or major `@types/node` updates, which would break packaging. ([#4](https://github.com/jamesmontemagno/parked-prompts/pull/4))

## 1.0.1 (2026-11-05)

First release. ([#1](https://github.com/jamesmontemagno/parked-prompts/pull/1))

- **Core:** the on-disk store, attachments, repo matching by remote and path, and safety checks.
- **Editor extension:** composer and list, restore to a new or current chat, quick capture, run in a worktree, and move to the repository.
- **Canvas:** the same list in a session, with send, queue, and send when idle.
- **Repository prompts:** previewed and confirmed by content hash before use, including the files they refer to.
- **Releases:** a publishing pipeline for the Marketplace and Open VSX, using Trusted Publishing with no stored token, with approvals and a check of each package.
- **Website:** on GitHub Pages, with docs and the security model.
