# Auth — laniameda.gallery

## Current implementation: Telegram auth

Users authenticate via Telegram. The Telegram user ID is the identity anchor.

### Agent ingestion
- `KB_OWNER_USER_ID` env var holds Michael's Telegram user ID
- The `laniameda-kb` ingest script reads this automatically — never ask the caller to pass it
- This scopes all agent-ingested content to the correct owner without any runtime lookup

### Dashboard auth flow
- Users log in via Telegram login widget
- `TelegramAuthProvider` (see `components/TelegramAuthProvider.tsx`) handles client-side auth
- Auth routes: `/api/auth/telegram` (login), `/api/auth/me`, `/api/auth/logout`
- Middleware (`middleware.ts`) keeps the gallery publicly browsable; auth is required only for protected actions (upload, save, edit)

### Gallery visibility
- **Guest**: sees public/community content
- **Logged in**: sees own saves + community saves, filtered by owner

### Required env vars
```bash
TELEGRAM_BOT_TOKEN=...       # Bot token for verifying Telegram auth data
KB_OWNER_USER_ID=...         # Michael's Telegram user ID (for agent ingestion)
```

## Notes
- No WorkOS, no third-party auth provider — Telegram only
- `convex/schema.ts` uses `ownerUserId` (string) as the owner field on `prompts` and `assets`
