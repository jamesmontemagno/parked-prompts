# Phase 0 harness

Re-checks the assumptions in [docs/spike-results.md](../../docs/spike-results.md) against a VS Code build. Run this when a new Insiders might have changed the internal commands the extension depends on.

It uses a throwaway profile, and needs Linux with `xvfb-run` and Node.js 22 or later. The first run packages the test extension with `npx @vscode/vsce`.

```sh
export VSCODE_BIN=/path/to/code-insiders   # the Electron binary, such as /usr/share/code-insiders/code-insiders

# Main window: checks A, C, D, E
./launch.sh &
sleep 25
node editor-checks.mjs
kill %1

# Agents window: checks B, I
./launch.sh --agents &
sleep 25
node agents-checks.mjs
kill %1
```

Each line says `PASS` or `FAIL`. `INFO` lines flag limits that may have been lifted, such as the chat input button starting to work.

`extension/` is a small test extension that runs commands over a local HTTP port. It is only for this harness, and is not part of the product.
