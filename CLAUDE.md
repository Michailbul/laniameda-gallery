# CLAUDE.md — laniameda.gallery

Use Bun. Read agent-docs/PROGRESS.md, agent-docs/OBSERVATIONS.md and convex/schema.ts
before work. For gallery use follow the canonical skills/laniameda-gallery skill,
discover live MCP tools/schemas and check authenticated access before claiming it.

## Current objects

Media assets hold images/videos, references and linked generation prompts. Skills
hold reusable techniques/recipes, optionally ordered prompt/media steps. Worlds
are root collections; collections group assets/Skills with at most one child level.
Tags carry piece type, medium, source and exact style. Native Stories/Scripts hold
private ideas/scripts/style locks with versions. X bookmarks retain post text.
YouTube references are separate research objects; Motion and Cinematography are
tagged asset/Skill views. Folder/workflow/pillar/pack are internal legacy names;
ordinary grouped media does not need to become a Skill.

Read authenticated references/worlds.md for the current world map and native style
locks. Public files only bootstrap private policy retrieval; do not publish private
world/anchor IDs. Current human direction governs intent. Preserve existing assets,
flags and world routes. Use the current branch-local feature spec when one exists.
Do not start an old handoff merely because a historical document names it active.

## Runtime and verification

Next authenticates Telegram sessions/agent tokens, derives the owner, and signs
short-lived Convex actor JWTs. Private backend functions require signed owner auth;
the legacy unsigned-owner bridge is disabled. Tokens belong in environment only.
MCP/tool JSON never supplies ownerUserId. Discover the deployed skill at /llms.txt.

Canonical cloud backend: dev:perfect-buffalo-375, serving real gallery data.
Use the sanitized cloud wrapper and check inherited Convex env; backend pushes
are publication, not read-only inspection. Public world identity is a showcased
root regardless of whether it has children; private members remain private.

Keep durable normalization/ownership logic in the backend and avoid unnecessary
abstractions. Use indexed queries, return validators and idempotent mutations.
Keep skill/docs synchronized with contract changes. Run lint/tests after changes;
type/runtime checks relevant to the actual change precede completion claims.
