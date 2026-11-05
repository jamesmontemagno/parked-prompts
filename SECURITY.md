# Security

## Reporting a vulnerability

Please use [private vulnerability reporting](https://github.com/jamesmontemagno/parked-prompts/security/advisories/new) rather than a public issue.

## What this project protects against

Prompts instruct AI agents, and repository prompts arrive by Git, so anyone with commit access can write one. These are in scope:

- A repository prompt being used without the user reading that exact version
- A prompt or attachment reading files outside its folder, through `..`, an absolute path, or a symlink
- Markup or script in a prompt running in the sidebar or the canvas
- The agent sending or arming a prompt by itself
- Restoring sending a prompt
- Git credentials from a remote URL being stored

The personal store is protected by file permissions (`0600` files in `0700` folders on macOS and Linux). It is not encrypted, and other software running as your user can read it. The canvas server only listens on `127.0.0.1`, with a per-launch token.

The secret scan when moving a prompt to a repository is a helpful check, not a guarantee. Read what you commit.
