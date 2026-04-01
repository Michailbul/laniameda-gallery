# VPS Skill Sync Handover

Use this handover when an agent on the VPS needs to:

1. pull the latest `main` branch of `laniameda-gallery`
2. align the VPS with the canonical `laniameda-gallery-ingest` skill from this repo
3. make future updates trackable via `npx skills`

## Goal

Install the canonical GitHub-backed skill from:

`https://github.com/laniamedaHQ/laniameda-gallery/tree/main/skills/laniameda-gallery-ingest`

Target agent runtimes:

- OpenClaw
- Codex
- Cline/agents

Do not assume the installer will materialize separate folders for every runtime. On the local machine, `npx skills` installed the skill under `~/.agents/skills/laniameda-gallery-ingest` and marked it as usable by multiple runtimes.

## Current setup and rules

- The canonical source of truth is this repo on `main`.
- The canonical skill folder is `skills/laniameda-gallery-ingest/`.
- Installed skill copies under home directories are disposable runtime installs, not editable source.
- Never hand-edit `~/.openclaw/skills/laniameda-gallery-ingest`, `~/.codex/skills/laniameda-gallery-ingest`, or `~/.agents/skills/laniameda-gallery-ingest`.
- If the ingest contract changes in the repo, the skill must change in the same repo commit.
- Preferred steady state on the VPS: GitHub-backed install from this repo.
- Acceptable fallback if GitHub-backed install hangs: local-path install from the checked-out repo.

## Repo location

Run these commands from the VPS checkout of:

```bash
/path/to/laniameda-gallery
```

If you are not sure where the repo is on the VPS, find it first and report the resolved path before continuing.

## Step 1: pull the latest repo changes

From the repo root:

```bash
git remote -v
git branch --show-current
git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
```

Expected result:

- current branch is `main`
- pull completes cleanly
- `HEAD` matches the latest remote `origin/main`

If `git pull --ff-only` fails because of local changes, stop and report:

- repo path
- current branch
- `git status --short`

Do not discard or overwrite local changes automatically.

## Step 2: verify prerequisites

The VPS must have:

- this repo checked out and updated
- `bun` installed
- `npx` available
- `KB_OWNER_USER_ID` set in the runtime env where the skill will run
- `CONVEX_URL` set to the correct production Convex deployment URL

Verify env first:

```bash
printenv KB_OWNER_USER_ID
printenv CONVEX_URL
```

Also verify tooling:

```bash
bun --version
npx --version
```

## Step 3: install / re-install the tracked skill

Run from the repo root:

```bash
bun run skills:install:github
```

This should register the GitHub source with `npx skills` and install `laniameda-gallery-ingest` globally for OpenClaw, Codex, and Cline.

If the runtime already has an older manual copy, this command should replace it with the tracked install. Do not hand-edit installed copies afterward.

## Step 4: fallback if GitHub-backed add hangs

On the local machine, `npx skills add <github-url>` recognized the source correctly but stalled during the clone step. If that happens on the VPS, fall back to a repo-local install so the server is at least aligned to the canonical repo copy:

```bash
npx skills add ./skills/laniameda-gallery-ingest -g -a codex -y
npx skills add ./skills/laniameda-gallery-ingest -g -a openclaw -y
npx skills add ./skills/laniameda-gallery-ingest -g -a cline -y
```

This fallback aligns the installed skill immediately, but it is local-path based rather than GitHub-tracked. If you have to use the fallback, report it explicitly.

## Step 5: verify installation locations

```bash
find ~/.openclaw/skills/laniameda-gallery-ingest ~/.codex/skills/laniameda-gallery-ingest ~/.agents/skills/laniameda-gallery-ingest -maxdepth 3 -type f 2>/dev/null | sort
```

Confirm the script exists:

At minimum, confirm one installed path now contains:

- `SKILL.md`
- `references/ingest-examples.md`
- `references/schema-contract.md`
- `scripts/ingest.ts`

Also inspect the installed `SKILL.md` header to confirm it is the new canonical version:

```bash
sed -n '1,40p' ~/.agents/skills/laniameda-gallery-ingest/SKILL.md 2>/dev/null
```

It should mention:

- canonical source: `skills/laniameda-gallery-ingest/`
- `CONVEX_URL` runtime env
- `references/schema-contract.md`

## Step 6: verify `npx skills` update behavior

```bash
bun run skills:update
```

This should run:

```bash
npx skills check
npx skills update
```

Expected result:

- no install errors
- if GitHub-backed install succeeded, skill source is recognized as GitHub-backed
- future updates can be applied with `bun run skills:update`

Important:

- `npx skills update` updates the entire installed catalog, not just `laniameda-gallery-ingest`
- if you only want to verify the command path works, let it start and confirm it discovers updates; do not leave a long unrelated bulk update running unless that is intended maintenance

## Step 7: smoke-test the installed skill

Check the script can start and fail for the right reason if input is missing:

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts
```

Expected result:

- exits with usage help

Then run a JSON parse check:

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{}'
```

Expected result:

- fails because `KB_OWNER_USER_ID` / `CONVEX_URL` or content is missing, which confirms the correct script is executing

## Step 8: operational rule going forward

From now on:

- edit only `skills/laniameda-gallery-ingest/` in this repo
- never hand-edit `~/.openclaw/skills/laniameda-gallery-ingest`, `~/.codex/skills/laniameda-gallery-ingest`, or `~/.agents/skills/laniameda-gallery-ingest`
- after pulling new commits on the VPS, run:

```bash
bun run skills:update
```

If the VPS is using the local-path fallback instead of GitHub-backed install, after every future `git pull` also run:

```bash
bun run skills:install:local
```

## Report back

The agent should report:

- whether the GitHub-backed install succeeded or had to fall back to local-path install
- which actual install path `npx skills` used on the VPS
- whether `bun run skills:update` completed or only verified the update path
- the current `CONVEX_URL` in use on the VPS
- whether the installed `ingest.ts` is reachable in the expected paths
