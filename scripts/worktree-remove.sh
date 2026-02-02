#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/worktree-remove.sh [--branch] [--force] <worktree-path> [worktree-path...]

Removes git worktrees. Optionally deletes the corresponding branches.

Examples:
  scripts/worktree-remove.sh .worktrees/palette-hazard
  scripts/worktree-remove.sh --branch .worktrees/palette-hazard .worktrees/palette-acid
  scripts/worktree-remove.sh --force --branch .worktrees/palette-brass

Flags:
  --branch  Delete the branch associated with the worktree after removal.
  --force   Force remove worktree even if it has local changes.
EOF
}

delete_branch=false
force_remove=false
paths=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      delete_branch=true
      shift
      ;;
    --force)
      force_remove=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      paths+=("$1")
      shift
      ;;
  esac
done

if [ "${#paths[@]}" -lt 1 ]; then
  usage
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo "Not inside a git repository."
  exit 1
fi

for worktree_path in "${paths[@]}"; do
  if [ ! -d "$worktree_path" ]; then
    echo "Worktree not found: $worktree_path"
    continue
  fi

  worktree_branch="$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -z "$worktree_branch" ]; then
    echo "Unable to determine branch for $worktree_path"
  fi

  if [ "$force_remove" = true ]; then
    git worktree remove --force "$worktree_path"
  else
    git worktree remove "$worktree_path"
  fi

  if [ "$delete_branch" = true ] && [ -n "$worktree_branch" ] && [ "$worktree_branch" != "HEAD" ]; then
    git branch -D "$worktree_branch"
  fi
done

echo "Done. Current worktrees:"
git worktree list
