# Run-book: deploy the read-cost changes and move to split semantic storage

For Michael's machine. Nothing here has been run against the canonical
deployment (`dev:perfect-buffalo-375`, real gallery data); each push and each
migration step is a separate decision. Byte figures: `DATABASE_IO.md`.

## What ships, and what each step changes

| Step | Changes behaviour | Database I/O |
|---|---|---|
| 1. Push backend + deploy Vercel | Search reads less (lane depth, cutoff, hydration); unchanged reindexes stop rewriting rows; the inventory export and the extension's saved-status client exist. Storage stays legacy. | none to deploy |
| 2. Baseline eval (optional) | nothing | ~10–20 MB |
| 3. `SEMANTIC_STORAGE=dual` | Reindexes also write split rows (copied from current legacy vectors, no provider call) | ~+15 KB per reindex |
| 4. Migration dry run | nothing | ~10 MB |
| 5. Migration apply | Fills the split tables from legacy rows, no provider calls | ~357 MB read once, ~80 MB written |
| 6. Eval legacy vs split | nothing | ~20–30 MB |
| 7. `SEMANTIC_STORAGE=split` | Search and reindex use split storage only | the savings |
| 8. Delete legacy tables (later) | frees ~357 MB storage | — |

Steps 3–5 need the deployment enabled and enough Database I/O left this month
(the copy alone is about a third of the Free plan's 1 GB). Plan or billing
changes are Michael's call; nothing here changes them. Also check the Usage
page's database storage first: split storage adds ~80 MB until step 8.

## Environment for the scripts

```bash
export CONVEX_URL=https://perfect-buffalo-375.convex.cloud
export CONVEX_ADMIN_KEY=...   # or CONVEX_DEPLOY_KEY; never commit it
export OWNER=<Michael's ownerUserId, the value of EXTENSION_OWNER_USER_ID>
```

The scripts refuse any other deployment URL or a conflicting `CONVEX_DEPLOYMENT`.

## Steps

1. **Deploy.** After the PR is approved and merged, push the backend first
   (`bun run convex:dev`, the sanitized cloud push; schema adds four tables and
   no field changes), then deploy Vercel (the inventory route and skill files).
   Reload the browser extension (0.12.2) from `extension/`.
   Smoke test: `bun skills/laniameda-gallery/scripts/gallery.mjs all_assets --out /tmp/inv`
   should print `"source":"export"` (the first call builds the snapshot).

2. **Baseline eval (optional).** Shows the effect of the new lane depths alone:
   ```bash
   bun scripts/semantic-search-eval.ts --owner=$OWNER --plans=before,tuned --out=eval-tuned.json
   ```
   Expect `tuned` to match `before` on top results (overlap@10 ≥ 0.8). If it
   does not, raise `FIRST_TAKE_MIN`/`FIRST_TAKE_MAX` in `convex/semanticSearch.ts`.

3. **Write both layouts.**
   ```bash
   bunx convex env set SEMANTIC_STORAGE dual
   ```

4. **Dry run.** Reads source rows and entries, never a legacy vector row, writes nothing:
   ```bash
   bun scripts/migrate-semantic-split.ts
   ```
   It prints `missing` (sources a copy would touch) and the estimated bytes.

5. **Copy.**
   ```bash
   bun scripts/migrate-semantic-split.ts --apply --batch-size=25
   ```
   Each line is one batch with its `nextCursor`. If it stops, resume with
   `--cursor=<last nextCursor>`; rerunning from the start is also safe, since
   sources that already have an entry are skipped. Afterwards a dry run should
   report `missing` equal to the copy's `noLegacyVectors` (sources with no
   legacy vectors, such as videos without text). `unverifiedPixel` /
   `unverifiedText` count vectors copied without a hash because the legacy hash
   no longer matched the source; the next reindex of those assets re-embeds them.

6. **Compare legacy and split search.**
   ```bash
   bun scripts/semantic-search-eval.ts --owner=$OWNER --similar=<3 asset ids> --out=eval-split.json
   ```
   Ten default queries (Gothic city at dusk, Art Deco interior, romance
   close-up, cyberpunk street, flower shop at night, …); `--queries=file.txt`
   replaces them. Gate: `split` mean overlap@10 against `before` ≥ 0.8 and
   top-1 agreement ≥ 8/10. Look at disagreeing queries with
   `preview_assets` before deciding; a different but equally good result is
   fine. If 768 dimensions do not hold, stay on `dual`, raise
   `SEMANTIC_VECTOR_DIMENSIONS` to 1536 in `convex/semanticStorage.ts`, clear
   `semanticEntries`/`semanticPixelVectors`/`semanticTextVectors`, push, and
   repeat steps 5–6.

7. **Switch.**
   ```bash
   bunx convex env set SEMANTIC_STORAGE split
   ```
   Watch Usage → Database I/O by function for a day. `semanticIndex:reindexAsset`
   and `semanticSearch:*` should drop to the "After" column of `DATABASE_IO.md`.

8. **Retire legacy storage (later, separate change).** After a quiet week,
   delete `semanticDocuments` and `semanticDocumentIdentities` from the Convex
   dashboard and remove the legacy code paths. Convex does not document
   whether a dashboard table deletion counts as Database I/O.

## Rollback

- Any time before step 7: `bunx convex env set SEMANTIC_STORAGE legacy` stops
  split writes; search never left legacy storage.
- After step 7: set `dual` to read legacy again. Assets edited while on `split`
  have stale legacy rows; `bun scripts/backfill-semantic-index.ts` (in `dual`)
  refreshes them but re-reads every legacy row (~357 MB). The split tables can
  stay; they are only read in `split` mode.
- The code itself can be reverted after step 1 without data changes: the new
  tables are additive and nothing old was removed.
