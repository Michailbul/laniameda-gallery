# Auth — laniameda.gallery

## Architecture: Unified auth (Telegram primary + WorkOS optional)

The `users` table in Convex is the **identity hub**. It maps `telegramId` ↔ `workosUserId` so that both login methods resolve to one canonical `ownerUserId`.

### Identity resolution
- **Telegram login** (primary): `ownerUserId` = `telegramId`
- **WorkOS login** (Google etc.): `ownerUserId` = `workosUserId` until Telegram is linked, then flips to `telegramId`
- All existing ingested data uses Telegram user ID as `ownerUserId` — linking Telegram makes that data visible immediately

### Agent ingestion
- `KB_OWNER_USER_ID` env var holds Michael's Telegram user ID
- The `laniameda-kb` ingest script reads this automatically — never ask the caller to pass it
- This scopes all agent-ingested content to the correct owner without any runtime lookup

### Dashboard auth flow
- `TelegramAuthProvider` (see `components/TelegramAuthProvider.tsx`) handles client-side Telegram auth
- `useCurrentUser` hook (`lib/use-current-user.ts`) resolves Telegram session → Convex `users` table → canonical user
- Auth routes: `/api/auth/telegram` (login), `/api/auth/me`, `/api/auth/logout`
- WorkOS routes: `/sign-in`, `/sign-up`, `/callback` (for Google login / account linking)
- Middleware (`middleware.ts`) is a passthrough — gallery is publicly browsable; auth is required only for protected actions

### Server-side auth
- `lib/server-auth.ts` provides `getAuthUser()` and `requireAuth()` for API routes
- Checks Telegram session first, falls back to WorkOS
- All API routes use this unified helper instead of WorkOS `withAuth` directly

### Account linking
- `convex/users.ts` provides `linkTelegram` and `linkWorkos` mutations
- When logged in via WorkOS, user can "Connect Telegram" → patches `telegramId` + updates `ownerUserId`
- When logged in via Telegram, user can "Connect Google" → patches `workosUserId`

### Gallery visibility
- **Guest**: sees public/community content
- **Logged in**: sees own saves + community saves, filtered by `ownerUserId`

### Required env vars
```bash
TELEGRAM_BOT_TOKEN=...                # Bot token for verifying Telegram auth data
KB_OWNER_USER_ID=...                  # Michael's Telegram user ID (for agent ingestion)
SESSION_SECRET=...                    # ≥32 char secret for Telegram session JWT
```

### Optional env vars (for WorkOS/Google login)
```bash
NEXT_PUBLIC_WORKOS_CLIENT_ID=...      # Enables Google/WorkOS login
WORKOS_API_KEY=...
WORKOS_COOKIE_PASSWORD=...
```

## Key files
| File | Purpose |
|---|---|
| `convex/schema.ts` → `users` table | Identity hub (telegramId, workosUserId, ownerUserId) |
| `convex/users.ts` | Resolve/create user, link Telegram/WorkOS |
| `lib/use-current-user.ts` | Client-side unified identity hook |
| `lib/server-auth.ts` | Server-side unified auth (API routes) |
| `lib/telegram-auth.ts` | Telegram widget verification + session JWT |
| `components/TelegramAuthProvider.tsx` | React context for Telegram session |
| `components/ConvexClientProvider.tsx` | Convex + optional WorkOS AuthKitProvider |
