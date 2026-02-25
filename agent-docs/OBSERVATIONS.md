# Observations

Last updated: 2026-02

Technical notes and lessons learned. Update this when you hit a quirk.

---

## Convex

- Adding new Convex tables/functions requires `bunx convex codegen` — otherwise `convex/_generated/*` drifts and breaks references.
- Queries and mutations must NOT call external APIs; always use actions for that.
- Jimp (not sharp) is used for thumbnail generation — keeps os-specific binaries out of the Convex action bundle (`linux-arm64` compatible).
- `bunx convex dev` requires external network access (Convex hits Sentry ingest endpoint); run from a networked machine.
- For dynamic App Router API routes, use `params: Promise<{ ... }>` and `await params` to stay aligned with this repo's Next.js setup.

## Gallery / UI

- Masonry layout uses CSS columns + aspect-ratio reservation to stabilize layout during image load.
- Modal preview uses progressive swap: thumbnail loads first, full-res swaps in when loaded.
- `bun run build` may fail due to Turbopack font download issues (Nunito Sans) on restricted networks — run from a network-accessible machine.
- ESLint ignores `convex/_generated/**` — those are generated files; real lint signal comes from app code only.

## Auth

- Current auth: Telegram login via `/api/auth/telegram`. No WorkOS, no third-party auth provider.
- Gallery is guest-visible; auth required only for protected actions (upload, save, edit).
- `KB_OWNER_USER_ID` env var scopes agent-ingested content to the correct owner — never hardcode this, always read from env.

## Ingest

- Ingest idempotency key (`ingestKey`) prevents duplicate records on retries — always pass a stable key when ingesting programmatically.
- `laniameda-kb` skill reads `KB_OWNER_USER_ID` from env automatically; callers never pass `ownerUserId` directly.

## Dev workflow

- Worktree automation copies `.env.example` and runs `bun install` automatically via `scripts/worktree-create.sh`.
- Clearing `.next` before type checks avoids stale route validator files breaking `tsc`.
- Quality gates (`bun run lint` + `bun test`) are the reliable baseline; run before every commit.
