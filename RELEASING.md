# Releasing

Three things ship from this repository, each with its own workflow.

| What | Workflow | Runs when | Goes to |
|---|---|---|---|
| Extension | [`publish.yml`](.github/workflows/publish.yml) | You publish a GitHub Release, or run it by hand | VS Code Marketplace, the GitHub Release, and optionally Open VSX |
| Canvas plugin | [`publish-canvas.yml`](.github/workflows/publish-canvas.yml) | Canvas changes reach `main` | The `stable` branch, which is the plugin marketplace |
| Website | [`site.yml`](.github/workflows/site.yml) | Site changes reach `main` | GitHub Pages |

## One-time setup

Publishing uses [Trusted Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing), so there is no token to create, store, or rotate. Each run trades a GitHub OIDC token for a Marketplace credential that lasts 15 minutes. Marketplace PATs would stop working anyway: Azure DevOps retires global PATs on December 1, 2026.

### 1. Create the policy on the Marketplace

Open the [publisher management page](https://marketplace.visualstudio.com/manage), choose `vs-publisher-473885`, then **Trusted Publishing** > **Create**:

| Field | Value |
|---|---|
| **Policy name** | `Parked Prompts release` (any name works) |
| **Repository owner** | `jamesmontemagno` |
| **Repository** | `parked-prompts` |
| **Workflow** | `publish.yml` |
| **Environment** | `marketplace` |

These have to match exactly. Renaming the workflow file or the environment stops publishing until the policy is updated, and a test guards against doing that by accident.

### 2. Set up the repository

This needs admin on the repository:

```sh
gh auth login
./tools/setup-repo.sh
```

It turns on Pages, sets the repository's website and topics, and makes you the approver for deploys. It is safe to run again. Pass `--no-gate` to deploy without approvals.

The approval and the branch limit on the `marketplace` environment are real protection: since the policy names the environment, a change to the workflow on some other branch cannot publish.

### Open VSX (optional)

Open VSX has its own trusted publishing, and is off until you turn it on:

1. Create the `vs-publisher-473885` namespace on [Open VSX](https://open-vsx.org), if you do not have it.
2. Add a [trusted publisher](https://open-vsx.org/user-settings/trusted-publishers) with this repository, the workflow `publish.yml`, and the environment `open-vsx`.
3. Run `./tools/setup-repo.sh --open-vsx`.

## Publishing the extension

There is no version to bump. Each run publishes `1.0.<run number>`, so versions are unique and always increase. The `version` in `package.json` is a placeholder for local builds.

Do one of these:

- **Create a GitHub Release** with a tag starting with `v`. The VSIX is attached to it. The `marketplace` environment refuses other tags.
- **Run it by hand:** Actions > Publish > Run workflow, on `main`. It creates the `v1.0.<run number>` tag and release.

Each run then:

1. **Tests**, on stable and Insiders: `pnpm check` and the smoke suite inside real VS Code
2. **Packages** with the version stamped, then checks the VSIX: exact file list, version, channel, and that the bundle stands alone
3. **Waits for your approval** on the `marketplace` environment
4. **Publishes** to the Marketplace, with `vsce publish --oidc`
5. **Updates the GitHub Release**, and publishes to Open VSX if that is turned on

Only the publishing jobs can request an OIDC token. They run no build or tests, install with no scripts and no cache, and run `vsce` and `ovsx` from the lockfile. Re-running a failed run is safe, because a version that already published is skipped.

### If publishing fails

The job does not fall back to a token, so the error is the real one.

| The log says | What to do |
|---|---|
| `Marketplace OIDC token exchange failed` | The policy does not match this run. Compare all four fields with the table above |
| `GitHub Actions did not provide an OIDC token request URL` | The job lost `id-token: write`. Restore it in `publish.yml` |
| The job never starts, on a tag | The `marketplace` environment only accepts `main` and `v*` tags |
| A permission error on the very first publish | Upload the VSIX from the run's artifacts once, at the [publisher page](https://marketplace.visualstudio.com/manage), then re-run |

### Pre-release channel

To try a build on real users first, check **Publish to the pre-release channel** when running it by hand, or mark the GitHub Release as a pre-release. People who chose **Switch to Pre-Release Version** get it. The next normal run reaches everyone, because its version is higher.

### Before the first publish

The manifest has `"preview": true`, so the listing shows a Preview badge. Remove it when the [remaining live checks](docs/spike-results.md#what-is-left-for-you-to-run) are done.

### Publishing by hand

`--oidc` only works inside GitHub Actions. To publish from your machine, build the package and upload it at the [publisher page](https://marketplace.visualstudio.com/manage):

```sh
pnpm package:vsix
pnpm verify:vsix
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
