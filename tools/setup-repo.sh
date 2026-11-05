#!/usr/bin/env bash
# One-time repository setup for releases and the website. Safe to run again.
#
# Needs admin on the repository: run `gh auth login` first. It:
#   1. Turns on GitHub Pages, deploying from Actions
#   2. Sets the repository's website, description, and topics
#   3. Makes you the required approver for website and Marketplace deploys
#
# Publishing uses Trusted Publishing, so there is no token to store. Its one manual step,
# creating the policy on the Marketplace, is printed at the end.
#
# Options:
#   --no-gate   Skip the approvals, so deploys run without waiting for you
#   --open-vsx  Also publish to Open VSX, which needs its own trusted publisher
set -euo pipefail

REPO="${REPO:-jamesmontemagno/parked-prompts}"
SITE_URL="https://jamesmontemagno.github.io/parked-prompts/"
GATE=true
OPEN_VSX=false
for arg in "$@"; do
  case "$arg" in
    --no-gate) GATE=false ;;
    --open-vsx) OPEN_VSX=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo "==> GitHub Pages"
if gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null
else
  gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null
fi

echo "==> Repository details"
gh repo edit "$REPO" \
  --homepage "$SITE_URL" \
  --description "Save chat prompts with their files and images for later, without sending them." \
  --add-topic vscode-extension --add-topic github-copilot --add-topic copilot-canvas --add-topic prompts >/dev/null

# Limits an environment to main, and to release tags where a release can publish from.
limit_environment() {
  local environment=$1 allow_tags=$2 existing
  existing=$(gh api "repos/$REPO/environments/$environment/deployment-branch-policies" --jq '.branch_policies[].id')
  for id in $existing; do
    gh api -X DELETE "repos/$REPO/environments/$environment/deployment-branch-policies/$id" >/dev/null
  done
  gh api -X POST "repos/$REPO/environments/$environment/deployment-branch-policies" -f name=main -f type=branch >/dev/null
  if [ "$allow_tags" = true ]; then
    gh api -X POST "repos/$REPO/environments/$environment/deployment-branch-policies" -f name='v*' -f type=tag >/dev/null
  fi
}

create_environment() {
  local environment=$1 allow_tags=$2 reviewers='[]'
  if [ "$GATE" = true ]; then
    reviewers="[{\"type\":\"User\",\"id\":$(gh api user --jq .id)}]"
  fi
  gh api -X PUT "repos/$REPO/environments/$environment" --input - >/dev/null <<JSON
{ "reviewers": $reviewers, "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
  limit_environment "$environment" "$allow_tags"
}

echo "==> Environments$([ "$GATE" = true ] && echo ', with you as the approver')"
create_environment github-pages false
create_environment marketplace true

if [ "$OPEN_VSX" = true ]; then
  echo "==> Open VSX"
  # No reviewers: this job only runs after the Marketplace job, which you already approved.
  GATE=false
  create_environment open-vsx true
  gh variable set PUBLISH_OPEN_VSX --repo "$REPO" --body true
fi

cat <<EOF

Done. Next:
  1. Create the Trusted Publishing policy, if you have not yet: open
     https://marketplace.visualstudio.com/manage, choose vs-publisher-473885, then
     Trusted Publishing > Create, and enter:
       Repository owner  jamesmontemagno
       Repository        parked-prompts
       Workflow          publish.yml
       Environment       marketplace
  2. Merge the pull request, and approve the "github-pages" deployment in Actions.
     The site goes live at $SITE_URL
  3. Publish the extension: Actions > Publish > Run workflow, or create a GitHub Release
     with a v* tag.
EOF
if [ "$OPEN_VSX" = true ]; then
  cat <<EOF

For Open VSX, add a trusted publisher at https://open-vsx.org/user-settings/trusted-publishers
with this repository, the workflow publish.yml, and the environment open-vsx.
EOF
fi
