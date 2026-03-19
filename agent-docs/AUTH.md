# Auth — laniameda.gallery

## Architecture: Telegram-only identity

The gallery trusts Telegram as the canonical identity source. `convex/users` stores each Telegram session with `telegramId`, `ownerUserId` (matching the Telegram ID), and optional profile metadata. Fields like `workosUserId` still exist for historical reasons, but no runtime path currently populates or reads them on `main`.

### Identity resolution
- **Telegram login**: `ownerUserId` is the verified `telegramId`. The Telegram session cookie is minted server-side after verifying the widget hash with `TELEGRAM_LOGIN_BOT_TOKEN`.
- **Dev bypass**: `POST /api/auth/dev-login` (enabled by `DEV_AUTH_BYPASS_ENABLED`) simulates a Telegram session for local hosts using `DEV_AUTH_TELEGRAM_ID`. It sets the same session cookie so the rest of the app can reuse the normal flow.
- **Agent ingestion**: `KB_OWNER_USER_ID` scopes OpenClaw data to Michael’s Telegram ID. The ingest skill never needs to look up another identity.

### Auth flow
1. Client loads `components/TelegramAuthProvider` → it fetches `/api/auth/me`.
2. The login widget posts to `/api/auth/telegram`.
3. The server verifies `hash`, `auth_date`, and bot token, then sets the signed `SESSION_SECRET` cookie.
4. The client refreshes `/api/auth/me`, which now returns the Telegram payload.
5. Protected routes call `requireAuth()` → `lib/server-auth.ts` reads the same session cookie and exposes `{ source: "telegram", telegramId }`.

### Required env vars
```bash
NEXT_PUBLIC_CONVEX_URL=...        # Public Convex endpoint used in the browser
CONVEX_URL=...                    # Server-side Convex endpoint for Next.js routes
TELEGRAM_LOGIN_BOT_TOKEN=...      # Bot token for Telegram widget validation
TELEGRAM_NOTIFY_BOT_TOKEN=...     # Bot token used by Convex notifications (e.g., ingest confirmations)
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=... # Bot username for the login widget (no @)
SESSION_SECRET=...                # ≥32 character secret for signing the Telegram session JWT
KB_OWNER_USER_ID=...              # Michael’s Telegram ID for agent ingestion scoping
```

### Dev-only toggles
```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_TELEGRAM_ID=278674008
DEV_AUTH_FIRST_NAME=Dev
DEV_AUTH_USERNAME=dev
```
These enable `POST /api/auth/dev-login` and the dev button in the login card. Production rejects the dev route and enforces Telegram bits only.

### Key files
| File | Purpose |
|---|---|
| `lib/telegram-auth.ts` | Telegram payload verification, JWT session cookie helpers |
| `lib/server-auth.ts` | Server helper that reads the Telegram session cookie and throws if unauthenticated |
| `app/api/auth/telegram/route.ts` | Verifies the widget payload, sets the session cookie, returns user info |
| `app/api/auth/me/route.ts` | Returns the current Telegram user (used by `TelegramAuthProvider`) |
| `app/api/auth/logout/route.ts` | Clears the session cookie |
| `components/TelegramAuthProvider.tsx` | React context that drives login/logout flow |
| `lib/use-current-user.ts` | Maps the Telegram session to a Convex user via `api.users.resolveByTelegramId` |
| `components/ConvexClientProvider.tsx` | Provides Convex client wired to `NEXT_PUBLIC_CONVEX_URL` |

### Notes
- There is no active WorkOS route or provider on `main`. If WorkOS support is reintroduced, the required env vars and the auth helper should be updated concurrently.
