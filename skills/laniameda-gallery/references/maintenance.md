# Maintenance: source of truth, access, deployment

## Source of truth

- **The gallery code is the truth**: `convex/schema.ts`, `convex/validators.ts`
  and the files below. This skill describes it; when they disagree, the code
  wins and the skill gets fixed in the same commit.
- **Canonical skill source:** `skills/laniameda-gallery/` in this repo
  (`~/AI-video-work/laniameda/laniameda.gallery`, also reachable as
  `~/work/laniameda/laniameda.gallery`).
- **Claude Code and Codex read it through a symlink**, so there is one copy
  and nothing to sync: `~/.agents/skills/laniameda-gallery` → the repo folder,
  with `~/.claude/skills/laniameda-gallery` and `~/.codex/skills/laniameda-gallery`
  pointing at that. Edit the repo file and every agent sees it at once.
- Other agents (openclaw, cline) take `bunx skills` copies via
  `bun run skills:install:local`. Those copies are disposable.
- `laniameda-gallery-ingest` and `laniameda-gallery-query` were merged into
  this skill on 26 Sep 2026. The old installed copies are archived in
  `~/.claude/skills-archive/2026-09-26/`.

## Read first

Before constructing payloads or changing the ingest script, read these repo files:

- `convex/schema.ts`
- `convex/validators.ts`
- `convex/ingest.ts`
- `convex/agent_ingest.ts`
- `convex/workflows.ts`
- `app/api/ingest/route.ts`

When the save targets a world, also read:

- `convex/folders.ts` — kinds, `parentFolderId` nesting rules, `setFolderShowcased`
- `lib/collection-sections.ts` — the section names and their tags
- `convex/showcase.ts` — what the public `/w/<slug>` page actually reads
- `lib/video-ingest.ts` — the browser upload path that the large-video script mirrors

For navigation behaviour: `convex/menuFilters.ts` (island-bar pills),
`lib/medium.ts` (Animation / Live action), `app/api/extension/save/route.ts`
(what the browser extension tags).

## Access paths

**MCP (preferred for multi-user agents).** A local stdio server in
`mcp/laniameda-gallery/`. Tools: `save_asset`, `save_prompt`,
`update_gallery_item`, `delete_gallery_item`, `get_gallery_item`,
`list_assets`, `search_gallery`, `find_similar`, `check_sources`, `list_tags`,
`upsert_tag`, `upsert_tags`, `archive_tag`, `add_tag_aliases`,
`list_collections`, `create_collection`, `update_collection`,
`delete_collection`. The Next.js routes behind it (`app/api/agent/*`) ship with
the app deploy, not the Convex deploy. It needs:

```bash
LANIAMEDA_GALLERY_API_URL=https://<app-host>      # http://localhost:3317 for local dev
LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_...            # issued from /agents after login
```

As of 26 Sep 2026 it is **not** registered in Claude Code, and no token is set
in the shell. Setting it up is Michael's call (he issues the token).

**Direct Convex scripts (what Claude Code uses today).** Owner-scoped via
`KB_OWNER_USER_ID`. `folderIds` works: the first is primary, the rest are
linked right after the save.

```bash
CONVEX_URL=https://perfect-buffalo-375.convex.cloud KB_OWNER_USER_ID=<owner id> \
  bun run ~/.agents/skills/laniameda-gallery/scripts/ingest.ts '<JSON>'

CONVEX_URL=https://perfect-buffalo-375.convex.cloud KB_OWNER_USER_ID=<owner id> \
  bun run ~/.agents/skills/laniameda-gallery/scripts/query.ts '<JSON>'
```

Source both values from the repo's `.env.local`; never paste the owner id into
a prompt or a wrapper script.

## Agent descriptions: switches and backfill

Deployment env (set with `CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex env set …`):

- `AGENT_DESCRIPTIONS_ENABLED=true` turns on the automatic pass for new assets
  saved without an `agentDescription`.
- `AGENT_DESCRIPTION_MODEL` overrides the vision model (default
  `gemini-3.5-flash-lite`). `GEMINI_API_KEY` is shared with semantic search.

Backfill, all internal actions:

```bash
# count what's missing (no calls to Gemini)
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run agentDescriptions:backfillAgentDescriptions '{"dryRun":true}'
# describe everything missing, paced at spacingMs per call; reschedules itself page by page
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run agentDescriptions:backfillAgentDescriptions '{"spacingMs":1500}'
# rebuild the text lane for every asset, never touching the multimodal model
# (loop on nextCursor until done: true)
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run semanticIndex:backfillBatch '{"sourceType":"asset","batchSize":25,"textOnly":true}'
```

The description backfill re-indexes text only as well. **Never run a pixel-lane
backfill fast**: the multimodal embedding model allows only a few requests a
minute, and live search shares that budget. Pixel lanes that are still missing
(the ~900 assets stuck before 26 Sep) need either a quota increase for
`gemini-embedding-2` in Google Cloud, or a slow drip of `backfillBatch` without
`textOnly` at one batch of 1 every ~20 s.

## Deployment ground truth (direct-Convex path only)

One Convex deployment serves both local dev and production: `dev:perfect-buffalo-375`
at `https://perfect-buffalo-375.convex.cloud`. There is no separate prod
deployment — never pass `--prod`.

The shell commonly inherits `CONVEX_DEPLOYMENT` pointing at a *different*
project. `bunx convex run …` picks that up silently and resolves IDs against the
wrong tables, returning plausible-looking wrong data. Always prefix CLI calls:

```bash
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run folders:listFolders '{"ownerUserId":"<id>"}'
```

Scripts that build their own `ConvexHttpClient` should hardcode the cloud URL
rather than read `process.env.CONVEX_URL`, for the same reason. And source
secrets from the repo's `.env.local` explicitly — `export $(grep … .env.local)`
run from a scratch directory silently finds nothing and dumps the whole
environment.

## When the contract changes

1. Change the code.
2. Update `references/data-model.md` (and `ingest.md` / `query.md` if the
   payloads moved) in the same commit.
3. Run the skill tests: `bun test tests/gallery-skill-scripts.test.ts
   tests/gallery-skill-workflow-args.test.ts tests/gallery-ingest-video-prep.test.ts
   tests/gallery-agent-filters.test.ts tests/hybrid-search.test.ts
   tests/agent-descriptions.test.ts`, then the whole suite with `bun test`.
4. Claude Code and Codex pick it up through the symlink. Refresh the other
   agents with `bun run skills:install:local`.

**When Michael says he pushed gallery updates:** `cd
~/AI-video-work/laniameda/laniameda.gallery && git pull`. No need to ask.
