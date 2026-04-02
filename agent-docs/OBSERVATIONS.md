# Observations

Last updated: 2026-03-07

Technical notes and lessons learned. Update this when you hit a quirk.

---

## Convex

- Adding new Convex tables/functions requires `bunx convex codegen` — otherwise `convex/_generated/*` drifts and breaks references.
- Queries and mutations must NOT call external APIs; always use actions for that.
- Jimp (not sharp) is used for thumbnail generation — keeps os-specific binaries out of the Convex action bundle (`linux-arm64` compatible).
- `bunx convex dev` requires external network access (Convex hits Sentry ingest endpoint); run from a networked machine.
- Tightening Convex enum validators against live tables can block deploys if older rows still carry legacy literal values; migrate the data first or keep the validator backward-compatible until cleanup lands.
- For dynamic App Router API routes, use `params: Promise<{ ... }>` and `await params` to stay aligned with this repo's Next.js setup.
- Folders are owner-scoped in backend APIs; always pass `ownerUserId` to `folders.listFolders` and validate folder ownership before writing `folderId` to assets/prompts.

## Gallery / UI

- Masonry layout uses CSS columns + aspect-ratio reservation to stabilize layout during image load.
- Modal preview uses progressive swap: thumbnail loads first, full-res swaps in when loaded.
- Folder filters are now scope-safe: treat `folderId` as `mine`-scope only and clear stale folder selections when switching to `public` or when folder IDs no longer exist.
- `bun run build` may fail due to Turbopack font download issues (Nunito Sans) on restricted networks — run from a network-accessible machine.
- ESLint ignores `convex/_generated/**` — those are generated files; real lint signal comes from app code only.

## Auth

- Current auth: Telegram login via `/api/auth/telegram`. No WorkOS, no third-party auth provider.
- Telegram auth now prefers `TELEGRAM_LOGIN_BOT_TOKEN` (with legacy fallback to `TELEGRAM_BOT_TOKEN` during migration).
- Telegram auth is origin-bound. `https://oauth.telegram.org/embed/<bot>?origin=...` should return the widget HTML for the canonical production host and `"Bot domain invalid"` for unregistered Vercel aliases; keep aliases redirected to a single approved host.
- Gallery is guest-visible; auth required only for protected actions (upload, save, edit).
- `KB_OWNER_USER_ID` env var scopes agent-ingested content to the correct owner — never hardcode this, always read from env.
- For localhost work without tunnel domain churn, enable dev bypass (`NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true` + `DEV_AUTH_BYPASS_ENABLED=true`) and use `/api/auth/dev-login` from the login card.

## Ingest

- Ingest idempotency key (`ingestKey`) prevents duplicate records on retries — always pass a stable key when ingesting programmatically.
- `ingestKey` is not a patch key. Use `ingest:updateFromApi` or `ingest:deleteFromApi` for record changes after creation.
- `laniameda-gallery-ingest` skill reads `KB_OWNER_USER_ID` from env automatically; callers never pass `ownerUserId` directly.
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
