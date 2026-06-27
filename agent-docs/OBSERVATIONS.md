# Observations

Last updated: 2026-05-08

Technical notes and lessons learned. Update this when you hit a quirk.

---

## Convex

- Adding new Convex tables/functions requires `bunx convex codegen` — otherwise `convex/_generated/*` drifts and breaks references.
- Queries and mutations must NOT call external APIs; always use actions for that.
- Jimp (not sharp) is used for thumbnail generation — keeps os-specific binaries out of the Convex action bundle (`linux-arm64` compatible).
- New image assets and generated thumbnails are stored in R2 (`r2Key` + `thumbR2Key`) with Convex `_storage` kept only as a fallback for legacy rows or temporary thumbnail uploads.
- `R2_PUBLIC_BASE_URL` is required for R2-backed assets to hydrate to public CDN URLs; without it, URL resolution intentionally falls back to legacy Convex storage or `sourceUrl`.
- Pillars are no longer a closed enum for assets/prompts/tags. Keep default UI affordances for `creators`, `designs`, and `dump`, but backend filters and ingest paths must accept any non-empty custom pillar key.
- User tag customization lives in `userTags`, which points to canonical `tags` rows. Do not make the existing `tags` table owner-scoped without first removing global `by_normalized` uniqueness assumptions.
- `bunx convex dev` requires external network access (Convex hits Sentry ingest endpoint); run from a networked machine.
- Tightening Convex enum validators against live tables can block deploys if older rows still carry legacy literal values; migrate the data first or keep the validator backward-compatible until cleanup lands.
- For dynamic App Router API routes, use `params: Promise<{ ... }>` and `await params` to stay aligned with this repo's Next.js setup.
- Folders are owner-scoped in backend APIs; always pass `ownerUserId` to `folders.listFolders` and validate folder ownership before writing `folderId` to assets/prompts.

## Gallery / UI

- Masonry layout uses CSS columns + aspect-ratio reservation to stabilize layout during image load.
- Modal preview uses progressive swap: thumbnail loads first, full-res swaps in when loaded.
- Folder filters are now scope-safe: treat `folderId` as `mine`-scope only and clear stale folder selections when switching to `public` or when folder IDs no longer exist.
- Midjourney's `/create` detail panel may not expose a stable `role="dialog"` or close-button signal. Extension save-widget suppression also checks visible detail-panel labels such as `Creation Actions` to avoid injecting save buttons across the dimmed background grid.
- Midjourney direct job routes (`/jobs/<id>?index=...`) render the same detail-view surface as Create and must also suppress background grid save widgets.
- Midjourney Create history is virtualized: rendered generation rows are absolutely positioned with inline `top`/`height` values, and only nearby rows exist in the DOM. Do not sort/reorder the feed; the extension's `Liked only` mode can only hide currently rendered unliked cards while preserving Midjourney's original spacing.
- `bun run build` may fail due to Turbopack font download issues (Nunito Sans) on restricted networks — run from a network-accessible machine.
- ESLint ignores `convex/_generated/**` — those are generated files; real lint signal comes from app code only.

## Auth

- Current auth: Telegram login via `/api/auth/telegram`. No WorkOS, no third-party auth provider.
- Telegram auth now prefers `TELEGRAM_LOGIN_BOT_TOKEN` (with legacy fallback to `TELEGRAM_BOT_TOKEN` during migration).
- Telegram auth is origin-bound. `https://oauth.telegram.org/embed/<bot>?origin=...` should return the widget HTML for the canonical production host and `"Bot domain invalid"` for unregistered Vercel aliases; keep aliases redirected to a single approved host.
- Gallery is guest-visible; auth required only for protected actions (upload, save, edit).
- Local Claude/Codex agent access is token-scoped: logged-in users create agent tokens, MCP calls `/api/agent/*`, and the app derives `ownerUserId`. Do not deploy the current stdio MCP as a shared hosted process because it reads one local token from env. `KB_OWNER_USER_ID` is legacy/admin-only and must not be used for multi-user agents.
- For localhost work without tunnel domain churn, enable dev bypass (`NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true` + `DEV_AUTH_BYPASS_ENABLED=true`) and use `/api/auth/dev-login` from the login card.

## Ingest

- Ingest idempotency key (`ingestKey`) prevents duplicate records on retries — always pass a stable key when ingesting programmatically.
- `ingestKey` is not a patch key. Use `ingest:updateFromApi` or `ingest:deleteFromApi` for record changes after creation.
- Agent ingest should use the local `laniameda-gallery` stdio MCP with `LANIAMEDA_GALLERY_AGENT_TOKEN`; direct `CONVEX_URL` + `KB_OWNER_USER_ID` skill calls are legacy and single-owner.
- Local MCP intentionally exposes one visual save/read path: `save_asset` + `list_assets`/`search_gallery`. UI/design references are assets classified by tags, not separate MCP tools.
- Agent customization should use MCP tools backed by `/api/agent/customize`; token auth derives the user for pillars, tags, and folders.
- Canonical agent skill source is `skills/laniameda-gallery-ingest/` in this repo; installed copies under `.openclaw/.codex/.agents` should be treated as disposable `npx skills` installs.
- Telegram ingest confirmations are sent by Convex using `TELEGRAM_NOTIFY_BOT_TOKEN` (legacy fallback `TELEGRAM_BOT_TOKEN`).
- The Next.js Telegram webhook route has been removed; ingest is OpenClaw -> Convex action.
- Prompt-only saves are explicit-only: use `allowPromptOnly=true` when intentionally storing text without media or design inspirations. Selected URLs alone do not count as persisted gallery records.
- Prompt-only persistence is now explicit: maintained ingest paths must set `allowPromptOnly=true` to keep text without a linked asset or design inspiration, and local/legacy ingest code should roll back newly created prompts on downstream asset failures.
- Pack sync now lives in the asset/prompt mutation layer, not just ingest orchestration. Shared-prompt multi-image records auto-normalize into `assetPacks`, and older rows can be backfilled with `assetPacks:consolidateOwnerPromptPacks`.

## Dev workflow

- Worktree automation copies `.env.example` and runs `bun install` automatically via `scripts/worktree-create.sh`.
- Clearing `.next` before type checks avoids stale route validator files breaking `tsc`.
- Quality gates (`bun run lint` + `bun test`) are the reliable baseline; run before every commit.
- Local `vercel --prod` deploys can upload the root `.env` into the build context unless `.vercelignore` excludes it; keep `.env*` and `convex/.env*` out of Vercel uploads so builds use project-configured envs instead of local secrets.
