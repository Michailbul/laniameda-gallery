# Inspiration review: the vertical slice (6 Nov 2026)

Branch `feat/inspiration-review`. Built with Claude Code CLI, Opus 5.5, high
effort, as Michael required. The canonical inspiration design is a private
gallery Skill; this file holds only what the code does and what it does not.

## Goal

Michael finds a saved reference and the take made from it on his phone,
writes what he likes, asks for a change, sees the new version, approves it and
files it into the project, without re-briefing anyone. Library first: a saved
reference is complete on its own; takes are optional.

## What shipped

- Tables `inspirationSources`, `inspirationAdaptations`, `inspirationVersions`,
  `inspirationEvents` (`convex/inspirationValidators.ts`, indexed, owner-scoped).
- `convex/inspiration.ts`: list (bounded scan, cursor), get, promotion
  shelves, feedback feed; agent writes register / propose / post version /
  block; owner decisions note (source, take), keep / unkeep / drop / recover
  (source), approve / drop / recover (take), redo, promote, undo promotion;
  newspaper facts. `convex/inspirationMedia.ts` cuts card thumbnails for media
  versions.
- Owner-only gate: `ownerSessionMutation` (convex/actor.ts) requires the
  signed token's `via: "session"` claim, minted only by
  `/api/auth/convex-token` for a signed-in browser. Agent tokens (and the
  extension and local scripts) can read and propose, never decide.
  Verified on a real local Convex backend: agent-style token refused with
  "Only Michael…", session token accepted.
- `/api/agent/inspiration` + MCP tools `list_inspiration`, `get_inspiration`,
  `list_inspiration_feedback`, `register_inspiration`,
  `propose_inspiration_adaptation`, `post_inspiration_version`,
  `block_inspiration_adaptation`. Decision actions answer 403.
- `/inspiration` (library: Show / Stage / Kind / Project / About filters,
  masonry at honest ratios, archive grayed in place, keys 1 / 2 / O / C) and
  `/inspiration/<source>` (source strip, credit, preservation, partial count,
  caption labelled as data, notes, each take with a version timeline, source
  beside take, cost, references, prompt, and separate Approve / Change /
  Promote / Undo / Drop controls naming the version). Sidebar and phone
  browse-sheet entrance.
- Newspaper facts gain `inspiration` (new references; ready, change requested
  and blocked takes, open until resolved) and a section on /newspaper.

## Semantics (enforced, tested in tests/inspiration.test.ts)

- Registering never moves or retags assets; repeats only add.
- Drafts are version rows, not assets: absent from grid, search, similarity,
  world pages and reference picks. `list_inspiration` shows draft outputs only
  with `includeDrafts`.
- Note: inert. No task, no state change. A source note is mirrored onto the
  lead asset's comment thread as `source: "inspiration"` (no task).
- Redo: names the reviewed version, creates exactly one task (ingestKey per
  event; a second request while one is open is refused). Calls no provider.
- Every decision passes `expectedRevision`; stale ones are refused.
- Approve accepts exactly one version. Promote requires the approved version,
  a shelf inside the take's world, creates/reuses one asset (never public,
  starred or featured), adds one membership, records the `assetFolders` row.
  Undo removes that row only if it still exists.
- Drop (take): recoverable, suppresses new proposals for that source + target,
  later versions are kept as orphans. Drop (source): archived, suppresses all
  new proposals for it.

## Acceptance evidence

- `bun test`: 1160 pass, 0 fail (12 new in tests/inspiration.test.ts).
- `bun run lint`, `bunx tsc --noEmit`, `bun run build`: clean.
- Real UI on localhost against an isolated local Convex backend and a fixture
  owner (900000001), Chrome headless: 390px phone (library, source, note,
  change request with a double tap, reload persistence) and 1440px desktop
  (v2 arrives, approve, promote to a shelf, undo, newspaper section). One
  redo event and one task after the double tap; zero tasks from the note.
  Page width 390 at 390px.

## Limitations (not fixed in this slice)

- **Media privacy:** outputs and source media resolve to the public R2 bucket
  with year-long cache. Only already-public external references belong here;
  no personal-photo upload path was added. Private byte delivery is a P0 gate
  for personal material.
- Supervised single writer: no worker leases or fencing tokens, no budget
  ledger, no provider idempotency or unknown-outcome quarantine in code. The
  agent contract says to report unknown outcomes and never resubmit.
- Token scopes stay coarse (gallery:read/write/delete); only owner decisions
  are hard-gated.
- Undo of a promotion that created its asset leaves that asset in the vault
  with no shelf (shows under Studio in the newspaper).
- The library cursor uses `updatedAt`; sources with an identical timestamp at
  a page edge can be skipped.
- Feedback is read by polling `list_inspiration_feedback`; there is no push
  consumer.
- No Telegram, Instagram or Photos capture here; sources are registered by
  agents after the existing intake saves them.

## Follow-ups

1. Private original/thumbnail delivery (signed URLs, private cache) before any
   personal capture.
2. Worker leases with fencing, budget reservation and unknown-outcome
   quarantine before autonomous generation.
3. Register the existing @romances carousel (8 readable assets) as the first
   real source, once the parent reconciles the ninth.
4. World pages: a References filter that resolves inspiration relations.
