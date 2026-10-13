# Convex read-cost reduction: review and verification

This is a code-only draft. No deployment, live backfill, storage deletion,
provider API call, billing-setting change or production write is included.

## Changes and expected cost mechanism

1. **Semantic hits:** resolve the union of both vector lanes through a small
   identity table. Scores, candidate limits and fusion stay intact. Existing
   rows fall back to their vector documents until the metadata migration has
   run. A synthetic dual-vector test record is 104,224 JSON bytes; its identity
   is 316 bytes. This is a payload/read-amplification proxy, not a measured
   production billing reduction.
2. **Newest filtered browsing:** use 60-source-row pages for tag groups,
   exclusions, model/media/liked filters and flattened worlds. Short or empty
   pages retain their cursor; the UI advances through empty visible frontiers.
   Traversal has no 600/2,000-result ceiling. Membership tests read only the
   current candidate's links, and hydration reuses those results. Worlds walk
   owner assets, so parent-plus-child membership is deduplicated and legacy
   primary-only membership still works. Filtered collections use asset creation
   dates, not filing dates. These newly paged views merge owner spellings into
   one chronological stream using the official Convex stream helpers and their
   matching React pagination hook. Pinned page boundaries remain contiguous
   through reactive inserts/deletes and read-budget splits. Unfiltered single
   collections retain their existing indexed membership cursor.
3. **Public collection counts:** maintain transactional per-asset contribution
   snapshots and folder counters. After migration readiness, public count reads
   touch folder rows rather than every public asset and membership. Private
   browsing derives publish indicators from owner folder rows and skips the
   public subscription. Until readiness, the original exact query remains.
4. **Manual semantic source backfill:** native cursors replace a full-table
   collect/sort for each batch. The metadata-only migration does not generate
   embeddings.

Semantic search also rechecks the current asset's owner/public flag after
hydration, and similarity checks its current source asset before reading
vectors. A stale index hit cannot return a newly private or foreign asset
while asynchronous reindexing catches up. Result checks reuse existing reads;
similarity adds one small source-asset read.

These changes exchange small additional metadata storage and mutation writes
for fewer repeated large reads. Savings depend on actual traffic and should be
verified using the deployment's function-level bytes-read profile after an
authorized rollout. Reading all pages still reads the full selected source;
sparse filters can traverse many short pages.

## Deliberately retained behavior

- Featured and seeded shuffle still use the existing bounded global window.
  Applying them to only the newest page would alter their meaning. A complete
  globally ordered lightweight feed is a separate change.
- Cards still hydrate prompt text, bookmark content and details. Prompt text
  currently determines automatic prompt-family grouping, lexical search and
  card display; removing it without a compatible summary/grouping model would
  change results. Pagination reduces how many cards are hydrated initially.
- Existing unfiltered owner feeds retain their sequential legacy-ID candidate
  cursors for backward compatibility. Newly paged filtered/world feeds use the
  merged chronological path; they do not inherit that ordering limitation.
- The single-collection cursor retains its existing membership-date order and
  its assumption that legacy primary membership is mirrored to join rows.

## Rollout

- [Semantic identity migration](SEMANTIC_READ_COST_MIGRATION.md)
- [Public collection count migration](PUBLIC_COLLECTION_COUNTS_ROLLOUT.md)

Both require explicit separate deployment/backfill authorization. The dev-labelled
canonical Convex deployment serves real gallery data. The new paginated query
arguments require backend-first deployment, followed by the UI. Existing API
contracts and legacy fallbacks remain available during migration.

## Verification environment

- Bun 1.4.3; dependencies installed from the committed lockfile.
- Full ESLint and TypeScript checks pass. All 89 tests in 12 affected suites
  pass, with 435 assertions. Independent review reproduced and verified
  the legacy-primary-only collection-flattening fix and reviewed the final
  semantic authorization follow-up.
- Offline Convex code generation used the installed CLI's local
  `codegen --system-udfs --typecheck disable` path, preserving the existing
  unchanged R2 component runtime and type declaration. No deployment was
  contacted; the source-driven data model picks up the additive schema.
- Production build uses `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:9`, an
  intentionally unreachable loopback placeholder. Static first-screen data
  falls back empty. This verifies compilation/build, not live connectivity.
- Browser QA is blocked in this executor: Next's listening server encounters
  `uv_interface_addresses` EPERM, and Chromium exits at `socket()` EPERM even
  after the tool-approved execution retry. No browser interaction is claimed.

## Existing test-suite failures

The aggregate `bun test` run is not green. Running all 112 test files in separate
processes reports 707 passing tests and 10 failures across seven files. This
removes cross-file mock pollution; the same seven failing files also
fail on untouched main at `bbb9de84500680afd76c587ebf5525bc2efae5d5`:

- `convex-actor-auth.test.ts`: existing agent-token scope mutation classification
- `gallery-entries.test.ts`: existing prompt-family grouping expectations
- `gallery-skill-scripts.test.ts`: old pack-argument expectations
- `prompt-context-query.test.ts`: retired workflow-context expectations
- `skill-create.test.ts`, `skills.test.ts`: imports of removed workflows module
- `telegram-streaming-integration.test.ts`: removed legacy worker export

These unrelated failures are not silently changed as part of billing work.
Focused behavioral tests cover semantic lookup/migration, counter readiness and
write paths, and full sparse/world pagination. Live billing attribution,
schema validation against deployed records, and authenticated browser flows
remain rollout validation tasks.
