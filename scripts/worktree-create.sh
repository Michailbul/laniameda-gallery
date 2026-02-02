#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/worktree-create.sh [--copy-env] [--install] [--convex-dev] <branch> [branch...]

Creates git worktrees under .worktrees/<branch> for each branch name.
If a branch exists, it is used. Otherwise a new branch is created.

Examples:
  scripts/worktree-create.sh --copy-env --install palette-hazard palette-acid palette-brass
  WORKTREES_DIR=/tmp/worktrees scripts/worktree-create.sh --copy-env my-feature

Flags:
  --copy-env    Copy .env.example to .env if .env does not exist in the worktree.
  --install     Run bun install inside each worktree after creation.
  --convex-dev  Run bunx convex dev inside each worktree (requires network).
EOF
}

copy_env=false
run_install=false
run_convex_dev=false
branches=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --copy-env)
      copy_env=true
      shift
      ;;
    --install)
      run_install=true
      shift
      ;;
    --convex-dev)
      run_convex_dev=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      branches+=("$1")
      shift
      ;;
  esac
done

if [ "${#branches[@]}" -lt 1 ]; then
  usage
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo "Not inside a git repository."
  exit 1
fi

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Repository has no commits yet. Create an initial commit first."
  exit 1
fi

worktrees_dir="${WORKTREES_DIR:-$repo_root/.worktrees}"
mkdir -p "$worktrees_dir"

for branch in "${branches[@]}"; do
  worktree_path="$worktrees_dir/$branch"
  if [ -d "$worktree_path" ]; then
    echo "Worktree already exists: $worktree_path"
  else
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      echo "Creating worktree for existing branch: $branch"
      git worktree add "$worktree_path" "$branch"
    else
      echo "Creating worktree for new branch: $branch"
      git worktree add -b "$branch" "$worktree_path"
    fi
  fi

  if [ "$copy_env" = true ]; then
    env_source="$repo_root/.env.example"
    env_target="$worktree_path/.env"
    if [ -f "$env_source" ] && [ ! -f "$env_target" ]; then
      cp "$env_source" "$env_target"
      echo "Copied .env.example to $env_target"
    fi
  fi

  if [ "$run_install" = true ]; then
    echo "Running bun install in $worktree_path"
    (cd "$worktree_path" && bun install)
  fi

  if [ "$run_convex_dev" = true ]; then
    echo "Running bunx convex dev in $worktree_path"
    (cd "$worktree_path" && bunx convex dev)
  fi
done

echo "Done. Current worktrees:"
git worktree list
