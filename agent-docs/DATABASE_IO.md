# Database I/O per function

Convex bills "Database I/O": document and index data moving between functions and
the database, reads and writes alike. The Free plan has 1 GB a month and stops
there (the gallery's deployment was disabled on 17–18 October 2026); Starter
charges $0.22 per GB after the first, Pro includes 50 GB. Vector and text
search are metered separately as "search queries". Plan figures:
docs.convex.dev/production/state/limits.

## How the numbers are computed

Sizes follow Convex's own value accounting (`convexValueSize` in
`convex/semanticStorage.ts`): a number is 9 bytes, a string its length + 2, so
a 3,072-float vector is 27,650 bytes. Representative rows:

| Row | Bytes |
|---|---|
| `semanticDocuments` (legacy, both lanes at 3,072) | 56,211 |
| `semanticDocumentIdentities` | 329 |
| `semanticEntries` (split) | 359 |
| `semanticPixelVectors` / `semanticTextVectors` (768) | 7,019 |
| `semanticQueryEmbeddings` at 3,072 / at 768 | 27,890 / 7,154 |
| One hydrated search/list result (asset, prompt, links, tags) | ~3,000 |
| Indexed lookup overhead (index key) | ~70 |

These are estimates from document sizes, not readings of the bill. The real
figures for any function are in the Convex dashboard: Project → Usage →
"Database I/O", broken down by function. Check it after any change here and
when the monthly total climbs. `bun scripts/semantic-search-eval.ts` measures
average row sizes on the live tables (`semanticSearch:measureSearchRowSizes`).

## Per call

| Function / path | Before (18 Oct) | After |
|---|---|---|
| `semanticSearch:searchAssets`, hybrid, no filters, limit 24 (agent default) | ~350 KB (2 × 28 KB query rows, up to 288 identity rows, 60-asset chunk) | ~180 KB on legacy storage (48 hits a lane, ~28 assets); ~140 KB split (7 KB query rows, hits cut by score before mapping) |
| same, with a selective filter | ~1.8 MB (256 hits a lane, up to 512 assets hydrated) | first pass ~0.7 MB (96 a lane); widens to 256 only when the limit is not filled, reading only new hits and assets |
| same, the gallery UI (limit 120) | ~620 KB | ~470 KB split (hydrating 120 results dominates) |
| the picture check on "no …" steps (`searchJudge`, `pictureJudgments`) | — | per page of 60: 60 index lookups for answers already kept (~10 KB), then one ~100-byte row written per picture asked for the first time. The model calls themselves read nothing from the database |
| every search since 11 Nov (`semanticSearch:searchAssets`, `findSimilarAssets`, `searchAssetsPage`) | 32–96 hits a lane, widened to 256 on demand | one pass of 256 hits a lane, each mapped through a slim row (~0.2 MB for both lanes), plus the assets read (~3 KB each): ~0.27 MB for an agent search of 24, ~0.4 MB for a grid page of 60. A grid search said in steps adds ~0.2 MB for each extra phrasing ("a / b") and each thing left out ("no cars"), first page only |
| the gallery UI since 10 Nov (`semanticSearch:searchAssetsPage` + `loadSearchHits`) | one-shot, 100 results at most | first page ~0.4 MB (256 hits a lane mapped once through slim rows, 60 assets hydrated); each further page ~180 KB (60 assets, no vector search). After the ranked hits the grid reads ordinary gallery pages for keyword matches: ~180 KB a page, ~16 MB if someone scrolls a search to the very end of the vault |
| the 18 Oct diagnosis' figure | ~16 MB unfiltered, ~29 MB filtered: true only before the 13 Oct identity table, when every hit read its 56 KB row | — |
| `semanticSearch:findSimilarAssets`, visual, limit 12 | ~266 KB (whole 56 KB source row + 60-asset chunk) | ~70 KB split (one 7 KB vector row, ~16 assets) |
| `semanticIndex:reindexAsset`, nothing changed | ~172 KB (two 56 KB reads + a 56 KB rewrite) | ~60 KB legacy (no rewrite); ~4 KB split |
| same, text edited | ~172 KB | ~12 KB split (one 7 KB text vector) |
| identity audit or backfill pass (13 Oct migration, run up to 3×) | ~357 MB a pass (6,345 × 56 KB) | split migration dry run ~10 MB; the one-time copy reads each legacy row once (~357 MB) and writes ~80 MB |
| complete inventory (`gallery.mjs all_assets`, 5,500 assets) | ~16 MB every traversal | one ~16 MB rebuild a day at most; a read is ~0.4 KB plus assets saved since |
| `assets:checkAssetIngestMatches` (extension "In gallery" badge) | up to ~10 KB a lookup, one request per viewed image, retried on every page scan while failing | same per request; requests batched, answers cached 5–30 min, failures paused 60 s, nothing while the tab is hidden |

Storage: `semanticDocuments` holds ~357 MB of the Free plan's 0.5 GB. Split
storage holds the same vectors in ~80 MB; deleting the legacy table after the
cutover (runbook step 7) returns the rest.

## What spends I/O here, and the rules

- **Anything that reads a legacy semantic row pays 56 KB.** Since 13 October
  search reads only slim identity rows; reindexing, similarity sources and
  every migration or audit pass still read whole rows. A full audit pass is a
  third of the Free plan's month. Split storage (`SEMANTIC_STORAGE=split`)
  keeps vectors in their own 7 KB rows, read only when needed.
- **Patches rewrite whole documents.** Never patch a row with unchanged values;
  compare first (`legacyUpsertChangesNothing`, `entryWriteChangesSomething`).
- **Hydrate what the request needs.** Unfiltered search hydrates about its
  limit; filters hydrate in 60-asset chunks until the limit is filled.
- **Map only hits that can be returned.** Split lanes are cut by score before
  any entry is read.
- **Complete inventories come from the cached export**
  (`convex/inventoryExport.ts`), not from paging every asset again.
- **Reactive queries re-run on every write to what they read.** An open gallery
  tab re-reads its loaded pages when agents edit those assets or bump a shared
  tag's count. Watch "subscriptions" in the usage breakdown during bulk edits.
- Query-embedding cache rows (`semanticQueryEmbeddings`) are never expired;
  each distinct query adds 7 KB (split) or 28 KB (legacy) of storage.
