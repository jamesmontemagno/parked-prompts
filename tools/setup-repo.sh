#!/usr/bin/env bash
# One-time repository setup for releases and the website. Safe to run again.
#
# Needs admin on the repository: run `gh auth login` first. It:
#   1. Turns on GitHub Pages, deploying from Actions
#   2. Sets the repository's website, description, and topics
#   3. Makes you the required approver for website and Marketplace deploys
#   4. Asks for the Marketplace token and stores it as a secret
#
# Options:
#   --no-gate    Skip the approvals, so deploys run without waiting for you
#   --no-secret  Skip the token prompt, to add it later
set -euo pipefail

REPO="${REPO:-jamesmontemagno/parked-prompts}"
SITE_URL="https://jamesmontemagno.github.io/parked-prompts/"
GATE=true
SECRET=true
for arg in "$@"; do
  case "$arg" in
    --no-gate) GATE=false ;;
    --no-secret) SECRET=false ;;
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

if [ "$SECRET" = true ]; then
  if gh secret list --repo "$REPO" --json name --jq '.[].name' | grep -qx VSCE_PAT; then
    echo "==> VSCE_PAT is already set"
  else
    echo "==> Paste the Marketplace token (Azure DevOps PAT with Marketplace > Manage). See RELEASING.md."
    gh secret set VSCE_PAT --repo "$REPO"
  fi
fi

cat <<EOF

Done. Next:
  1. Merge the pull request, and approve the "github-pages" deployment in Actions.
     The site goes live at $SITE_URL
  2. Publish the extension: Actions > Publish > Run workflow, or create a GitHub Release.
EOF
