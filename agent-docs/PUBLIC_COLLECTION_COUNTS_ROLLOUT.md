# Public collection count rollout

The complete backend and initial count backfill were deployed on 13 October
2026 after authorization. The stored cursor scanned 5,490 assets in 220 batches
and reached `complete: true`; all 42 public collections matched their original
exact counts. The canonical `dev:perfect-buffalo-375` deployment contains real
gallery data. Do not infer permission from its dev label.

## What changes

- `assets:listPublicCollections` reads a completion marker and the
  `folders.by_publicMemberCount` index once ready, with no asset/media reads or
  per-asset membership joins.
- `folders:listFolders` exposes `publicMemberCount` to its authenticated owner.
  Before completion it is undefined, including for partially counted folders.
  The owner UI must retain its old count source during that interval.
- Before the backfill completes the public query keeps its original exact
  scan. This deliberately preserves correctness while allowing the backend,
  frontend, and data to roll out independently. Most count-read savings arrive
  only after completing the backfill.
- `publicCollectionMemberships` stores each asset's actual contribution.
  Transactional set differences maintain counts through publish/unpublish,
  curator stars, membership replacement/add/remove, primary-folder edits,
  repeated saves, duplicate merges, asset deletion, and collection deletion
  or flattening. Private creation contributes zero. Duplicate links and
  primary-plus-link membership count once. Storybooks remain excluded from
  the public collection list.
- No publication flag, owner scope, media field, or public route is changed.

## Authorized deployment and backfill

1. Deploy the complete backend change, including every write hook, schema,
   new indexes and internal `publicCollectionCounts` module, using the
   canonical sanitized deployment flow in AGENTS.md. Do not deploy only the
   read fast path. This document does not authorize that operation.
2. Read `publicCollectionCounts:status`. An absent state reports
   `complete: false`, `cursor: null`, `scanned: 0`.
3. With explicit backfill authorization, invoke the internal
   `publicCollectionCounts:backfill` mutation with `{"batchSize":25}`.
   It processes at most 25 source assets (maximum 100 if explicitly passed),
   with a 512 KB source-page read budget. Linked membership reads are additional
   and scale with the memberships of that page's assets. Use smaller batches
   for assets with unusually many memberships.
4. Repeat the same call until it returns `complete: true`. The cursor is stored
   transactionally; never supply offsets, reset counters, or clear snapshots
   between calls. Each page reconciles rather than blindly incrementing, so
   repeats and automatic transaction retries cannot double count. Already
   complete calls do no work. The internal mutation does not schedule itself.
5. Read status again and verify several public collections against a reviewed
   source inventory, including an empty collection, primary-only legacy
   membership and a storybook. Validate anonymous and owner pages and compare
   the public-query database bytes/read profile before and after.

Live traffic may continue: backfill traverses immutable creation order and the
same transaction hooks handle changes on either side of its cursor. Completion
is committed in the same transaction as the last page, so partial counts never
become authoritative.

## Rollback and maintenance

- Roll back the frontend independently if necessary; the old public query
  contract remains unchanged.
- If reverting backend write hooks after readiness, also revert the public
  fast path and owner count exposure in the same deployment. Keeping new
  counter readers with old source writers would make counts stale.
- Do not edit `assets`, `assetFolders`, counter snapshots, or counts directly
  in the dashboard. Future membership/publication write paths must call
  `syncPublicCollectionMembership` in the same transaction after final writes.
- A negative counter raises an explicit repair error rather than silently
  clamping to zero. Stop the affected operation and investigate unauthorized
  direct edits or missing hooks; the initial backfill is not a reset/repair
  command. A rebuild after hook-less rollback/direct edits requires a reviewed
  migration before re-enabling the fast path.

No deployment, production mutation, backfill, or paid API call was performed
while preparing this implementation.
