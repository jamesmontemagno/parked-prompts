# Changelog

Newest first. Each pull request adds a line under **Unreleased**. After an extension release publishes, its lines move under that version. The canvas and the website go live when a change merges, but their lines still move with the next extension release.

## Unreleased

- **Changelog:** every pull request now adds an entry here, and each release moves them under its version.

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
