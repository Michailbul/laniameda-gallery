# Environment Matrix

Last updated: 2026-03-07

This is the canonical env map for running `laniameda.gallery` locally and in production.

## 1) Local dev (`.env.local`)

Required to boot app:

```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
SESSION_SECRET=... # min 32 chars
```

Recommended for local daily workflow (no Telegram widget domain dependency):

```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_TELEGRAM_ID=<your_telegram_id>
DEV_AUTH_FIRST_NAME=<your_first_name>
NEXT_PUBLIC_DEV_OWNER_USER_ID=<your_telegram_id>
```

Required for curation controls in dev:

```bash
CURATION_ADMIN_SECRET=<any_secret_string>
CURATION_ADMIN_USER_IDS=<your_telegram_id>,telegram:<your_telegram_id>
NEXT_PUBLIC_CURATION_ADMIN_USER_IDS=<your_telegram_id>,telegram:<your_telegram_id>
AGENT_TOKEN_ISSUER_SECRET=<same_secret_in_next_and_convex>
```

Optional local simulator:

```bash
DEV_TELEGRAM_SIM_ENABLED=true
DEV_TELEGRAM_SIM_AUTH_BYPASS=true
DEV_TELEGRAM_SIM_ALLOW_NON_LOCAL=false
```

## 2) Vercel project env (Production)

Set these in Vercel for the Next.js app:

```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
SESSION_SECRET=... # min 32 chars
TELEGRAM_LOGIN_BOT_TOKEN=...
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=...
AGENT_TOKEN_ISSUER_SECRET=<same_secret_in_next_and_convex>
CURATION_ADMIN_SECRET=...
CURATION_ADMIN_USER_IDS=<your_telegram_id>,telegram:<your_telegram_id>
NEXT_PUBLIC_CURATION_ADMIN_USER_IDS=<your_telegram_id>,telegram:<your_telegram_id>
AI_GATEWAY_API_KEY=... # required for /api/ai/* features
AI_RUNTIME_DEFAULT=ai_sdk
AI_TEXT_MODEL=anthropic/claude-sonnet-4.5
AI_IMAGE_MODEL_NANO_BANANA=google/gemini-3-pro-image
AI_IMAGE_MODEL_NANO_BANANA_FAST=google/gemini-2.5-flash-image
```

Production hardening:

```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=false
DEV_AUTH_BYPASS_ENABLED=false
DEV_TELEGRAM_SIM_ENABLED=false
DEV_TELEGRAM_SIM_AUTH_BYPASS=false
DEV_TELEGRAM_SIM_ALLOW_NON_LOCAL=false
APP_ENV_PROFILE=prod-telegram
```

## 3) Convex deployment env (Production)

Set these in Convex dashboard env vars:

```bash
TELEGRAM_NOTIFY_BOT_TOKEN=... # needed by convex/notifications.ts
AGENT_TOKEN_ISSUER_SECRET=... # must match the Next.js app env
CURATION_ADMIN_SECRET=...
CURATION_ADMIN_USER_IDS=<your_telegram_id>,telegram:<your_telegram_id>
KB_OWNER_USER_ID=<your_telegram_id>
```

Notes:
- `convex/notifications.ts` sends Telegram "Saved" notifications after ingest.
- Curation authorization in `convex/assets.ts` depends on Convex-side `CURATION_ADMIN_*` vars.

## 4) Agent MCP env

Preferred production agent path:

```bash
LANIAMEDA_GALLERY_API_URL=https://<your-app-host>
LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_...
```

Important:
- Users create agent tokens while logged in through `/api/agent/tokens`.
- The MCP server runs with `bun run mcp:gallery` and calls `/api/agent/*`.
- Agents must not receive `CONVEX_URL` or `KB_OWNER_USER_ID` for production multi-user access.
- The legacy `laniameda-gallery-ingest` and `laniameda-gallery-query` scripts still exist for local/admin migration workflows, but they are not the production agent boundary.

## 5) Telegram integration boundaries

- Web login widget domain allowlist is configured in BotFather via `/setdomain`.
- Ingestion is expected via OpenClaw skill -> Convex ingest action.
- This app does not expose a Telegram ingestion webhook route.
- Use separate bots/tokens:
  - Login bot: `TELEGRAM_LOGIN_BOT_TOKEN` + `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`
  - Notification bot: `TELEGRAM_NOTIFY_BOT_TOKEN` (Convex env)
- Legacy fallback during migration: `TELEGRAM_BOT_TOKEN` is still accepted by code for both paths, but should be phased out.

## 6) Smoke tests after env setup

1. Login test:
   - Open production URL.
   - Verify Telegram login succeeds (no `Bot domain invalid`).
2. Ingest test:
   - Send one prompt/image through OpenClaw.
   - Verify item appears in gallery.
   - Verify Telegram "✅ Saved" message arrives.
3. Curation test:
   - As admin, mark item public + featured.
   - Verify item appears in `Public` scope.
4. Security test:
   - Non-admin account cannot call curation route.
