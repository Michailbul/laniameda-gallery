# Semantic identity read-cost migration

This change is additive and has not been deployed or run against gallery data.
The dev-labelled canonical Convex deployment contains real gallery data. Obtain
separate authorization before publishing the schema/functions or running a write
migration. A draft PR does not authorize either action.

## What changes

- `semanticDocumentIdentities` stores the small identity/modality/visibility
  projection previously recovered by reading the entire vector document.
- Semantic writes and deletes maintain that row atomically in their existing
  mutation. Vector payloads and indexes, ranking, scope filters, and result
  contracts are unchanged.
- Asset hybrid/similarity search resolves the union of both lanes' hit IDs once.
  Skill search uses the same lightweight lookup. Similarity search still needs
  to read its one source vector document.
- Current hydrated asset ownership/publication is checked before results leave
  search, so an unpublished or reassigned asset cannot leak through stale
  vector metadata while reindexing catches up. Similarity-source authorization
  also checks the current asset before reading its vector (one source asset read).
- A missing identity falls back to the original document, so existing data
  remains searchable throughout rollout. No completeness flag or early cutover
  can hide legacy hits.
- Identity resolution is two-phase: one compact-only query for the unique hit
  IDs, followed by miss-only legacy queries with a server-enforced maximum of
  eight full documents each. This stays below the 16 MiB query read limit even
  when a document approaches Convex's 1 MiB document-size limit; vector bytes
  alone are not a safe bound because `searchText` can be large. Both asset lanes
  and Skill search use this resolver. The fully migrated path remains one
  identity query; migration-period misses trade extra query calls for bounded
  reads without truncation, score changes, or lost candidates.
- Source reindex backfill uses bounded native cursor pages instead of collecting
  and sorting a whole source table for every batch. Cursors are opaque; callers
  must use `done`, not `processed === 0`, as EOF. Old `createdAt::id` checkpoints
  remain accepted. Timestamp ties are filtered across bounded pages without
  skipping later eligible records. The updated script handles empty pages.

## Authorized rollout procedure

1. Review and publish the additive schema/functions through the repo's sanitized
   Convex workflow after separate deployment approval. Keep both vector indexes.
2. With protected environment configuration targeting the canonical deployment,
   audit coverage: `bun scripts/backfill-semantic-identities.ts --check`.
   This is read-only, but reads each vector document once in bounded pages.
3. After migration approval, run
   `bun scripts/backfill-semantic-identities.ts --apply --batch-size=25`.
   It only copies identity metadata, with no provider calls or scheduled reindex.
   Each logged `nextCursor` can resume the same mode using `--cursor=...`.
   Re-running from the start is safe and unchanged identities produce no writes.
4. Run `--check` again from the beginning. Require `missing: 0` and
   `mismatched: 0` with `done: true`. A resumed audit only verifies its suffix.
5. Compare database bytes read for representative owner/public text, visual,
   hybrid, and similarity searches, with the same filters, limits, and queries.
   Ranking and visible results should be unchanged. Keep the fallback while
   observing usage; removing it is not part of this change.

The migration reads each vector document once per full pass, then small identity
rows; it does not regenerate vectors. The legacy full-document source scan cost
was approximately N × ceil(N / batchSize) documents per reindex pass. Native
pagination reduces that source enumeration to approximately N documents.
Storage gains are not claimed: this intentionally adds one small row per vector
document to reduce repeated database read bytes. The vector-search engine's own
charges and final asset hydration are unchanged.

## Verification and rollback

Focused Bun tests exercise migration replay, write/update/delete consistency,
legacy fallback, source timestamp ties and empty-page resume, lookup read budgets,
shared lane lookup, unchanged rank fusion, and owner/public scope filters.
Regression cases also cover stale public/owner vector metadata for ordinary
search, similarity results, and similarity-source authorization.
Fallback budget tests resolve two disjoint 256-hit lanes with zero, half, and
full identity coverage, checking all 512 candidates and the final rank/score.
Near-limit documents with 900 KB of search text plus dual 3072-vectors verify
that eight-document fallback batches read less than 8 MiB of serialized fixture
data; a ninth ID is rejected server-side before any reads.
These mock-based checks count rows/payload bytes and are not a production bill
measurement or a substitute for the authorized deployment's readback.

Rollback application code while retaining the additive table is safe: the old
lookup still reads the original vector documents. If any older writer runs
without maintaining identities, rerun the metadata backfill and audit before
re-enabling the optimized reader. Do not remove vector documents or indexes.
