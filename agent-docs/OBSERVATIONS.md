# Observations

Last updated: 2026-10-07

Technical notes and lessons learned. Update this when you hit a quirk.

---

## Convex

- Adding new Convex tables/functions requires `bunx convex codegen` — otherwise `convex/_generated/*` drifts and breaks references.
- Queries and mutations must NOT call external APIs; always use actions for that.
- Card thumbnails come from one encoder, `encodeCardThumbnail` in `convex/thumbnails.ts`: sharp, WebP q78, fit inside 1440×960, never upscaled. `convex.json` lists sharp under `node.externalPackages`, so Convex installs the right platform binary on the server rather than bundling the Mac one. Jimp stays only as a JPEG fallback if sharp fails to load. The contract (box, WebP, when a thumb is sharp enough for a tile) lives in `lib/card-thumbnail.ts` and is shared by the grid and the backfill.
- Every server-side R2 write (`storeBlobToR2`) sets `Cache-Control: public, max-age=31536000, immutable`. Keys are fresh UUIDs and the R2 component refuses to store over an existing key, so this is safe. Objects uploaded straight from the browser via presigned PUT carry no Cache-Control.
- New image assets and generated thumbnails are stored in R2 (`r2Key` + `thumbR2Key`) with Convex `_storage` kept only as a fallback for legacy rows or temporary thumbnail uploads.
- `R2_PUBLIC_BASE_URL` is required for R2-backed assets to hydrate to public CDN URLs; without it, URL resolution intentionally falls back to legacy Convex storage or `sourceUrl`.
- Pillars are retired product taxonomy. Legacy columns remain compatible, but
  agents organize through collections and tags; Skills have a dedicated token contract.
- User tag customization lives in `userTags`, which points to canonical `tags` rows. Do not make the existing `tags` table owner-scoped without first removing global `by_normalized` uniqueness assumptions.
- `bunx convex dev` requires external network access (Convex hits Sentry ingest endpoint); run from a networked machine.
- Tightening Convex enum validators against live tables can block deploys if older rows still carry legacy literal values; migrate the data first or keep the validator backward-compatible until cleanup lands.
- For dynamic App Router API routes, use `params: Promise<{ ... }>` and `await params` to stay aligned with this repo's Next.js setup.
- Folders are owner-scoped in backend APIs; always pass `ownerUserId` to `folders.listFolders` and validate folder ownership before writing `folderId` to assets/prompts.
- Child collection cards should be read with `folders.listChildCollectionEntries`, which uses the `folders.by_parent` index and returns count + preview data without loading every collection in the vault.

## Gallery / UI

- Skills are a complete query while gallery assets are cursor-paginated. A dated
  Skill insert must wait until the asset frontier passes its timestamp (strictly,
  since equal dates can span pages). Collection cursors use membership dates, so
  their Skills wait for exhaustion. Keep exposed entry order stable while pages
  append, and reset it when the view changes; sorting every mixed batch inserts
  late assets above already-read Skills. Prefetch at the data frontier separately
  from the locally mounted tile frontier.
- Gallery and pack video previews remain paused and scrub 24 sampled frames from
  horizontal pointer position after a 250 ms rest. Seeking is throttled to 10/s,
  coalesces to the latest target, and waits for any in-flight seek. Posters render
  without video requests by default; leaving, scrolling or hiding the page cancels
  preview work. Explicit lightbox/modal playback keeps its normal controls.

- Published world identity follows a root's slug, not whether it still has child folders. Compare the public world route, home world cards and featured-piece world labels after curation; preserving asset flags alone misses navigation regressions. Keep internal audit notes out of public world descriptions.

- A toolbar popup closes as soon as the browser loses focus, so local Finder/file-manager drag-and-drop must live in the extension's persistent Side Panel (`side_panel.default_path` + `openPanelOnActionClick`), not `action.default_popup`.
- Browser-reserved shortcuts such as `Command+L` cannot be claimed by an extension. Use a manifest `commands` binding such as `Command+Shift+L` and let users remap it from Chrome's extension shortcuts page if desired.
- Local extension files use a token-authenticated `/api/extension/upload` handshake for a signed browser-to-R2 PUT, then `/api/extension/save` receives only the R2 key, media metadata, content hash, and small preview. Keep large bytes out of Next.js/Convex action arguments.
- Folder/drop uploads may omit both collection and tags. When either an ingest-key retry or a content-hash twin is found, reuse the original asset and additively merge only the newly selected tags/collection; never create another asset or erase its prior organization.
- Piece type is a tag, not a folder. Legacy section-named destinations remain
  compatible, but agents must not create new Characters/Locations/Scenes folders.
  Exact animation tag selects Animation; the fallback Live action filter also
  includes photoreal rendered work.
- Legacy section-named child folders are recognized for compatibility; current
  piece-type navigation uses tags and owner-curated menuFilters.
- In an unfiltered parent collection view, assets assigned to a visible child collection are intentionally hidden from the flat tile stream and represented by the child stack card. Opening/filtering the child shows its members normally.
- Masonry layout uses CSS columns + aspect-ratio reservation to stabilize layout during image load.
- `MasonryGrid` mounts no tiles until it has measured its width; the server HTML shows the skeleton instead. Tiles laid out without a width would render as a full-width stack in server HTML, jump at hydration and fetch every image in it.
- Public pages hand their first screen to the client from the server (`app/misha.buloy/selected_work/first-screen.ts`) and hint its thumbnails with `preload()`. Next prefetches the sibling public pages, and their hints fire too, so Chrome logs "preloaded but not used" for them; that is expected and makes switching views instant.
- Modal preview uses progressive swap: thumbnail loads first, full-res swaps in when loaded.
- Folder filters are now scope-safe: treat `folderId` as `mine`-scope only and clear stale folder selections when switching to `public` or when folder IDs no longer exist.
- Midjourney's `/create` detail panel may not expose a stable `role="dialog"` or close-button signal. Extension save-widget suppression also checks visible detail-panel labels such as `Creation Actions` to avoid injecting save buttons across the dimmed background grid.
- Midjourney direct job routes (`/jobs/<id>?index=...`) render the same detail-view surface as Create and must also suppress background grid save widgets.
- Midjourney CDN media elements commonly render resized WebP/JPEG derivatives. Re-encoding those bytes as PNG changes the container but cannot restore the original pixels. On direct job pages, resolve `/jobs/<id>?index=<n>` to `https://cdn.midjourney.com/<id>/0_<n>.png`, require a valid PNG signature, and fail without saving if the original cannot be fetched.
- Sequential Midjourney curation must not hold the side-panel Add button for the network round trip. Snapshot the current job/index and selected settings at dispatch, release the control immediately, and surface eventual success/failure through the content-script toast so navigation can continue while the save runs.
- Original Midjourney PNGs can exceed Vercel's function request-body limit after base64 expansion. Fetch and signature-check them in the extension service worker, upload the Blob through the signed R2 handshake, and pass only the R2 key plus media metadata into `/api/extension/save`.
- Midjourney Create history is virtualized: rendered generation rows are absolutely positioned with inline `top`/`height` values, and only nearby rows exist in the DOM. Do not sort/reorder the feed; the extension's `Liked only` mode can only hide currently rendered unliked cards while preserving Midjourney's original spacing.
- Tailwind v4 scans the whole repo for class names and registers every scanned directory with webpack. A symlink inside one (`.claude/skills/laniameda-gallery`) makes `next dev --webpack` die on its first compile with `Cannot read properties of undefined (reading 'length')` in `WasmHash`, and the request hangs. `app/globals.css` keeps `.claude` and `skills` out with `@source not`; do the same for any new directory that holds symlinks.
- Tag filters and pill counts read the `assetTags` join rows, not `assets.tagIds`. Any mutation that adds a tag to an asset must insert the join row too (see `assets:addAssetTags`, `bookmarks:linkAssetsToBookmark`).
- `bun run build` may fail due to Turbopack font download issues (Nunito Sans) on restricted networks — run from a network-accessible machine.
- ESLint ignores `convex/_generated/**` — those are generated files; real lint signal comes from app code only.

## Auth

- New `stories` and `galleryPresets` functions use `signedOwnerQuery` / `signedOwnerMutation`, which reject unsigned requests even if `LEGACY_OWNER_ARG_AUTH` is enabled for older functions. App and skill signing use key id `gallery-actor-20261006`; private key stays in ignored local and production environment configuration, public keys in Convex JWKS.
- Zod 4 `.partial()` retains nested defaults. Use the explicit no-default `storyPatchSchema` for partial updates so a body edit preserves kind, status, tags and source links.
- Sparse global tag filters must continue past a first batch of nonmatches even when no collections are hidden. Reuse the bounded older-owner scan; collection queries retain membership-index scoping.
- A later asset/collection deletion does not delete narrative text. `stories.getStoryLinkStatus` reports missing links; the editor lets the owner remove those links before saving, while prior revisions retain their source IDs.

- Current auth: Telegram login via `/api/auth/telegram`. No WorkOS, no third-party auth provider.
- Telegram auth now prefers `TELEGRAM_LOGIN_BOT_TOKEN` (with legacy fallback to `TELEGRAM_BOT_TOKEN` during migration).
- Telegram auth is origin-bound. `https://oauth.telegram.org/embed/<bot>?origin=...` should return the widget HTML for the canonical production host and `"Bot domain invalid"` for unregistered Vercel aliases; keep aliases redirected to a single approved host.
- Gallery is guest-visible; auth required only for protected actions (upload, save, edit).
- Local Claude/Codex agent access is token-scoped: logged-in users create agent tokens, MCP calls `/api/agent/*`, and the app derives `ownerUserId`. Do not deploy the current stdio MCP as a shared hosted process because it reads one local token from env. `KB_OWNER_USER_ID` is legacy/admin-only and must not be used for multi-user agents.
- For localhost work without tunnel domain churn, enable dev bypass (`NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true` + `DEV_AUTH_BYPASS_ENABLED=true`) and use `/api/auth/dev-login` from the login card.

## Ingest

- Extension saves can send `collectionPillar` with root `folderIds`; `/api/extension/save` idempotently creates/reuses that nested child collection and attaches the asset to both root and child. Midjourney profile/personalization saves default to `inspirations`.
- Agent/MCP asset saves are collection-first: resolve requested names with `list_collections` and pass `folderIds` for multi-collection create/update. Do not translate "my gallery" into a legacy pillar such as `creators`.
- Ingest idempotency key (`ingestKey`) prevents duplicate records on retries — always pass a stable key when ingesting programmatically.
- `ingestKey` is not a patch key. Use `ingest:updateFromApi` or `ingest:deleteFromApi` for record changes after creation.
- Prefer available hosted Gallery MCP; local stdio uses the same token API.
  Direct local/admin scripts require signed Convex owner auth, not just owner args.
- Local MCP intentionally exposes one visual save/read path: `save_asset` + `list_assets`/`search_gallery`. UI/design references are assets classified by tags, not separate MCP tools.
- Agent customization should use MCP tools backed by `/api/agent/customize`; token auth derives the user for pillars, tags, and folders.
- Canonical public skill source is skills/laniameda-gallery. Local agent views
  are symlinked; packaged plugins are versioned release snapshots. Private worlds
  and maintenance content are owner agentInstructions data, fetched through the
  skill resource contract. Old ingest/query skill directories were merged/removed.
- Telegram ingest confirmations are sent by Convex using `TELEGRAM_NOTIFY_BOT_TOKEN` (legacy fallback `TELEGRAM_BOT_TOKEN`).
- The Next.js Telegram webhook route has been removed; ingest is OpenClaw -> Convex action.
- Prompt-only saves are explicit-only: use `allowPromptOnly=true` when intentionally storing text without media or design inspirations. Selected URLs alone do not count as persisted gallery records.
- Prompt-only persistence is now explicit: maintained ingest paths must set `allowPromptOnly=true` to keep text without a linked asset or design inspiration, and local/legacy ingest code should roll back newly created prompts on downstream asset failures.
- Pack sync now lives in the asset/prompt mutation layer, not just ingest orchestration. Shared-prompt multi-image records auto-normalize into `assetPacks`, and older rows can be backfilled with `assetPacks:consolidateOwnerPromptPacks`.

## YouTube frame previews

- Public seek-storyboard metadata is cached for one hour; auth cookies, owner research and saved-video membership are checked outside that cache. API responses are private/no-store. Only saved IDs and HTTPS i.ytimg.com sprite URLs are accepted.
- Timed storyboard levels use `M$M` sheet names. The final sheet can have fewer rows than its maximum grid; cropping must use its actual remaining row count. Saved hq1/2/3 stills have no guaranteed quarter/mid/end timestamps. Restricted sources or upstream network blocks fall back honestly.

## Dev workflow

- Worktree automation copies `.env.example` and runs `bun install` automatically via `scripts/worktree-create.sh`.
- Clearing `.next` before type checks avoids stale route validator files breaking `tsc`.
- Quality gates (`bun run lint` + `bun test`) are the reliable baseline; run before every commit.
- Local `vercel --prod` deploys can upload the root `.env` into the build context unless `.vercelignore` excludes it; keep `.env*` and `convex/.env*` out of Vercel uploads so builds use project-configured envs instead of local secrets.

## Agent contract audit corrections (7 October 2026)

- LEGACY_OWNER_ARG_AUTH is disabled; unsigned owner arguments cannot authorize
  private gallery reads. Native text/presets/instruction resources always require
  signed auth. OAuth codes are single-use; unknown scopes and wrong redirects reject.
- Use list_assets_page through isDone for complete inventories; list_assets is capped.
- create_skill supports markdown-only reusable recipes and optional real step media.
  Collections group ordinary assets; do not promote every prompt variation to a Skill.
- set_video_poster changes only the thumbnail. An asset update with image media
  replaces a video, so it is never a poster-only recipe.
- Prevalidated folder IDs can still race with deletion. Partial results carry
  persisted IDs/failedStep: repair that existing ID rather than create duplicates.
- No mandatory passes-filters qualification/evidence gate. Keep source facts and
  observed statistics separate from interpretations. Automatic YouTube frames are
  approximate source stills, not exact timestamps or evidence of the opening.
- Current human direction and fetched private world policy supersede old global
  maps/historical memory. Never publish private anchor IDs in a public plugin/repo.
