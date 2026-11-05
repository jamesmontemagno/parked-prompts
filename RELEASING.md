# Releasing

Three things ship from this repository, each with its own workflow.

| What | Workflow | Runs when | Goes to |
|---|---|---|---|
| Extension | [`publish.yml`](.github/workflows/publish.yml) | You publish a GitHub Release, or run it by hand | VS Code Marketplace, optionally Open VSX, and the GitHub Release |
| Canvas plugin | [`publish-canvas.yml`](.github/workflows/publish-canvas.yml) | Canvas changes reach `main` | The `stable` branch, which is the plugin marketplace |
| Website | [`site.yml`](.github/workflows/site.yml) | Site changes reach `main` | GitHub Pages |

## One-time setup

Create a Marketplace token first. The publisher is the same one as `vscode-learn`, `vs-publisher-473885`.

1. In [Azure DevOps](https://dev.azure.com), create a personal access token with **Marketplace > Manage**, for **All accessible organizations**.
2. Then run this, which needs admin on the repository:

```sh
gh auth login
./tools/setup-repo.sh
```

It turns on Pages, sets the repository's website and topics, makes you the approver for deploys, and stores the token as the `VSCE_PAT` secret. It is safe to run again. Pass `--no-gate` to deploy without approvals.

To also publish to [Open VSX](https://open-vsx.org), add an `OVSX_PAT` secret. Without it, that step is skipped. As in `vscode-learn`, the workflow also accepts `VSCE_TOKEN` in place of `VSCE_PAT`.

## Publishing the extension

There is no version to bump. Each run publishes `1.0.<run number>`, so versions are unique and always increase. The `version` in `package.json` is a placeholder for local builds.

Do one of these:

- **Create a GitHub Release** with any tag. The VSIX is attached to it.
- **Run it by hand:** Actions > Publish > Run workflow, on `main`. It creates the `v1.0.<run number>` tag and release.

Each run then:

1. **Tests**, on stable and Insiders: `pnpm check` and the smoke suite inside real VS Code
2. **Packages** with the version stamped, then checks the VSIX: exact file list, version, channel, and that the bundle stands alone
3. **Waits for your approval** on the `marketplace` environment
4. **Publishes**, then attaches the VSIX to the GitHub Release

The token is only available in step 4, which installs and runs nothing except pinned `vsce` and `ovsx`. Re-running a failed run is safe, because a version that already published is skipped.

### Pre-release channel

To try a build on real users first, check **Publish to the pre-release channel** when running it by hand, or mark the GitHub Release as a pre-release. People who chose **Switch to Pre-Release Version** get it. The next normal run reaches everyone, because its version is higher.

### Before the first publish

The manifest has `"preview": true`, so the listing shows a Preview badge. Remove it when the [remaining live checks](docs/spike-results.md#what-is-left-for-you-to-run) are done.

### Publishing by hand

```sh
pnpm package:vsix
pnpm verify:vsix
cd packages/extension
npx @vscode/vsce login vs-publisher-473885
npx @vscode/vsce publish --packagePath dist/parked-prompts.vsix
```

## Publishing the canvas

Merging canvas or core changes to `main` builds the plugin in a clean worktree, runs its checks, and fast-forwards `stable`. People update with `copilot plugin update parked-prompts`.

To try it without publishing, from a clone of `main`:

```sh
cd packages/canvas
pnpm exec canvas-kit release --dry-run
```

## Publishing the website

The site is plain HTML, CSS, and JavaScript in [`site/`](site), with no build step.

| Step | What happens |
|---|---|
| Preview locally | `pnpm preview:site`, then open the URL it prints |
| Pull request | `pnpm check:site` runs in CI, and the built site is uploaded as a `site-preview` artifact to download and check |
| Merge to `main` | Waits for your approval on the `github-pages` environment, then goes live |

GitHub Pages has one public site per repository and no password protection, so there is no staging site. The preview artifact plays that role: it is private to people with repository access, and is never indexed.

To roll back, revert the commit on `main`, or re-run an earlier successful **Website** run.
