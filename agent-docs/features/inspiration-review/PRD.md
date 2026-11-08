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

## Dispatch safety (6–7 Nov 2026, branch `feat/inspiration-gates`)

Closes the critic's lease, budget, uncertain-job and revocation gates in code
(skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b), still with no provider calls.

- Tables `inspirationDispatch` (one per owner: pause switch, Michael's
  allowance, the single dispatcher lease with a rising fence) and
  `inspirationJobs` (priced reservations). `convex/inspirationDispatch.ts`.
- Paused by default; no row = paused. Only a browser session
  (`ownerSessionMutation`) sets an allowance (cap per 48 h ≤ $30, optional
  per-job cap, provider list, 1–60 days) or pauses. /inspiration shows a
  Generation strip: off/on, spend this cycle, Allow / Pause, and every
  unknown-outcome job with Charged / Not charged.
- One dispatcher: `claim` is refused while any live lease exists, whatever the
  label; nonce + fence on every write; a takeover moves in-flight jobs of
  older fences to `unknown_outcome`.
- `reserve` before every paid call: refused when paused / no or expired
  allowance / provider not covered / unknown price / above per-job cap /
  held + settled this cycle would pass the cap / take dropped or approved /
  another job for the take open or unknown. Idempotent on ingestKey.
- Unknown outcomes keep their budget held across cycles and are never
  resubmitted; `reconcile` needs the provider's own record, otherwise Michael
  resolves them.
- `post_inspiration_version` takes `jobId` + nonce + fence; a stale fence
  stores the version as an orphan that cannot become current.
- Agent tools `inspiration_dispatch`, `inspiration_job`
  (`/api/agent/inspiration` actions `dispatch`, `job`); skill 1.34.0.
- Skill drift fixed: extraction's stop-after-ten rule no longer applies to
  saved-collection capture; text-only references register as text sources;
  intake keeps the received representation beside a clean crop; personal
  originals stay off the public media path.
- Tests: tests/inspiration-dispatch.test.ts (11).

Still open: private byte delivery for personal originals; Telegram sender
binding test; Instagram capture coverage; Michael's phone walk-through.

## Private originals (7 Nov 2026, branch `feat/inspiration-private-media`)

Closes the critic's P0.1 byte-privacy gate for personal material.

- Table `inspirationPrivateMedia`; `convex/inspirationPrivate.ts`. Bytes go to
  Convex file storage (one-time upload URL), never the public R2 bucket.
  `attach` checks storage's own size / type / SHA-256 (hex), refuses a
  storageId recorded before (any owner), an unsupported type and >20 MB.
- Delivery: `/api/inspiration/media/<id>` (session cookie or owner agent
  token with gallery:read) → Convex HTTP action `/inspiration/private-media`
  (first `convex/http.ts`) under a freshly minted short-lived token. 401
  without auth, 404 for another owner, `private, no-store`, byte ranges for
  phone video. No storage URL is returned to any caller.
- `get_inspiration` → `privateMedia` with the gated url; the library shows a
  Private card (no preview, no grid load); the source page shows the files.
- Register accepts media with no assets when preservation is
  `owner_uploaded_bytes`. MCP tool `inspiration_private_media`; skill 1.35.0.
- `externalProcessing: "none"` on every row: no outside processor until
  Michael clears one (no UI for that yet).
- Tests: tests/inspiration-private.test.ts.

Limits: no display copy without EXIF yet (the owner sees the original as
received); no thumbnails (the grid never previews private files); files over
20 MB stay on the iMac; owner deletion/export of a private original is not
built.

## Remaining safety checks (8 Nov 2026, branch `claude/inspiration-safety`)

Closes the open items of task td71p8q3k90ceqeb64ttxywkes8hs3x2 (critic
skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b P0.3, P0.4, P0.1 leftovers, the two
PRD limitations and the fault drill).

- **P0.4 provenance.** Table `inspirationCaptures`: one row per intake event
  and representation (key, revision, representation, platform, channel,
  sourceUrl, creator, caption, assets, content hashes, private files). Every
  `register` records one. Same bytes from two platforms = one asset, two
  captures; screenshot then full file = two captures, the source keeps both
  assets and its preservation upgrades (never downgrades); a Telegram edit is
  a new revision under the same key, never a new source or take; a capture
  key belongs to one source. Asset level: `assetCaptures` keeps every other
  sourceUrl a deduplicated save came from (`alsoSavedFrom` on
  get_gallery_item); the first URL still sits on the asset.
- **Telegram binding (P0.3).** A Telegram capture (channel telegram or a
  `telegram:` key) needs the verified numeric sender = the owner's own
  Telegram id, chat type private and chat id = sender id, plus the message
  id. Groups, channels, other senders and bare telegram keys are refused
  before anything is written. Forwards Michael sends are kept with
  `forwardedFrom`. Raw ids are stored, never returned.
- **Narrow tokens (P0.3).** Scopes `inspiration:capture` (register text,
  links and private originals, attach, read back without drafts) and
  `inspiration:adapt` + `worldIds` (read library and feedback; propose, post,
  block, dispatch only for takes in its worlds). Created and edited at
  /agents with a project picker; OAuth consent copy added. Enforced in
  `/api/agent/inspiration` (lib/agent-scopes.ts); every other agent route
  still requires gallery:* so narrow tokens reach nothing else.
- **Private originals.** Attach is now the action
  `inspirationPrivateNode:attachPrivateMedia`: the first bytes are sniffed
  (lib/file-signature.ts) against the declared type; a mismatch (HTML error
  page, truncated, wrong format) is refused and the upload deleted. Images get
  a WebP display copy (2048) and thumbnail (480) via sharp with no metadata
  (EXIF, GPS, maker notes, ICC), autoOriented; HEIC sharp cannot decode,
  video and voice stay `original_only` with a note. The gated route serves
  `?variant=display|thumb|original` (default: the clean copy) and
  `&download=1` on the original. Owner session only: delete for good (bytes,
  copies, row; tombstone in `inspirationPrivateDeletions`), clear or withdraw
  a named processor per source (`clearedProcessors`, `externalProcessing`
  cleared), `/api/inspiration/export` (JSON list). `reserve` refuses a paid
  job whose provider is not cleared for every private file of the source.
  The source page shows Private files (clean-copy status, Original download,
  two-tap Delete, Outside services: Allow / Withdraw, Export list) and How it
  arrived (captures).
- **Library cursor.** `beforeTie` / `nextBeforeTie` (the last row's
  `_creationTime`) page cleanly through equal `updatedAt`.
- **Promotion undo.** A promotion that created its asset, undone with the
  asset on no other shelf, puts it in the Archive tray (worldPageHidden,
  reason "Promotion undone"); promoting again restores it.
- **Fault drill.** `scripts/inspiration-fault-drill.ts` runs crash after
  provider acceptance → takeover quarantine → refused resubmission and stale
  settle → reconcile from the provider record, on the live deployment under a
  throwaway `drill:<ts>` owner (no provider call, no spend, Michael's account
  untouched).
- Tests: tests/inspiration-captures.test.ts (7), inspiration-private (12),
  dispatch processor gate (1). Mock Convex creation times are now unique and
  increasing, like Convex.

Limits: world-scoped tokens are enforced in the Next route, not inside Convex
(Convex only accepts tokens Next mints); a capture token cannot save public
media into ordinary assets (that path still needs gallery:write); EXIF-free
copies exist for images only; >300 sources sharing one updatedAt at a page
edge would still need a second scan.
