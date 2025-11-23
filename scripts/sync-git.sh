#!/usr/bin/env bash
set -euo pipefail

# Ensure we run relative to this script's directory (project root).
cd "$(dirname "$0")/.."

if ! git diff --quiet --ignore-submodules HEAD -- || ! git diff --quiet --cached --ignore-submodules; then
  true
else
  echo "Nothing to sync. Working tree is clean."
  exit 0
fi

git add -A

if git diff --cached --quiet --ignore-submodules; then
  echo "No staged changes found after add. Exiting." >&2
  exit 0
fi

commit_message="code updated"

if git commit -m "$commit_message"; then
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  echo "Committed to $current_branch with message: '$commit_message'"
  git push -u origin "$current_branch"
else
  echo "Commit failed." >&2
  exit 1
fi
