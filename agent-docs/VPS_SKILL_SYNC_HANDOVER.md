# VPS Skill Sync Handover

Use this handover when an agent needs to align the VPS with the canonical `laniameda-kb` skill from this repo and make future updates trackable via `npx skills`.

## Goal

Install the canonical GitHub-backed skill from:

`https://github.com/Michailbul/laniameda-gallery/tree/main/skills/laniameda-kb`

Target agent runtimes:

- OpenClaw
- Codex
- Cline/agents

Do not assume the installer will materialize separate folders for every runtime. On the local machine, `npx skills` installed the skill under `~/.agents/skills/laniameda-kb` and marked it as usable by multiple runtimes.

## Preconditions

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

## Install / re-install the tracked skill

Run from the repo root:

```bash
bun run skills:install:github
```

This should register the GitHub source with `npx skills` and install `laniameda-kb` globally for OpenClaw, Codex, and Cline.

If the runtime already has an older manual copy, this command should replace it with the tracked install. Do not hand-edit installed copies afterward.

## Fallback if GitHub-backed add hangs

On the local machine, `npx skills add <github-url>` recognized the source correctly but stalled during the clone step. If that happens on the VPS, fall back to a repo-local install so the server is at least aligned to the canonical repo copy:

```bash
npx skills add ./skills/laniameda-kb -g -a codex -y
npx skills add ./skills/laniameda-kb -g -a openclaw -y
npx skills add ./skills/laniameda-kb -g -a cline -y
```

This fallback aligns the installed skill immediately, but it is local-path based rather than GitHub-tracked. If you have to use the fallback, report it explicitly.

## Verify installation locations

```bash
find ~/.openclaw/skills/laniameda-kb ~/.codex/skills/laniameda-kb ~/.agents/skills/laniameda-kb -maxdepth 3 -type f 2>/dev/null | sort
```

Confirm the script exists:

At minimum, confirm one installed path now contains:

- `SKILL.md`
- `references/ingest-examples.md`
- `references/schema-contract.md`
- `scripts/ingest.ts`

## Verify tracking with `npx skills`

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

- `npx skills update` updates the entire installed catalog, not just `laniameda-kb`
- if you only want to verify the command path works, let it start and confirm it discovers updates; do not leave a long unrelated bulk update running unless that is intended maintenance

## Smoke-test the installed skill

Check the script can start and fail for the right reason if input is missing:

```bash
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts
```

Expected result:

- exits with usage help

Then run a JSON parse check:

```bash
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{}'
```

Expected result:

- fails because `KB_OWNER_USER_ID` / `CONVEX_URL` or content is missing, which confirms the correct script is executing

## Operational rule

From now on:

- edit only `skills/laniameda-kb/` in this repo
- never hand-edit `~/.openclaw/skills/laniameda-kb`, `~/.codex/skills/laniameda-kb`, or `~/.agents/skills/laniameda-kb`
- after pulling new commits on the VPS, run:

```bash
bun run skills:update
```

## Report back

The agent should report:

- whether the GitHub-backed install succeeded or had to fall back to local-path install
- which actual install path `npx skills` used on the VPS
- whether `bun run skills:update` completed or only verified the update path
- the current `CONVEX_URL` in use on the VPS
- whether the installed `ingest.ts` is reachable in the expected paths
