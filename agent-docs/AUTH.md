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
TELEGRAM_LOGIN_BOT_TOKEN=...          # Bot token for verifying Telegram auth data
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=... # Bot username for Telegram widget (without @)
KB_OWNER_USER_ID=...                  # Michael's Telegram user ID (for agent ingestion)
SESSION_SECRET=...                    # ≥32 char secret for Telegram session JWT
```

Convex env also needs:
```bash
TELEGRAM_NOTIFY_BOT_TOKEN=...         # Bot token used by Convex "✅ Saved" notifications
```

### Telegram web login runbook (official flow)

Reference docs:
- https://core.telegram.org/widgets/login
- https://core.telegram.org/bots/features#web-login

1. **Create/select bot in @BotFather**
   - Use `/newbot` if needed.
   - Keep login token private (`TELEGRAM_LOGIN_BOT_TOKEN`).
   - Create a second bot for notifications and keep `TELEGRAM_NOTIFY_BOT_TOKEN` private.

2. **Link app domain to bot**
   - In @BotFather, run `/setdomain` and set your app domain.
   - For local testing, use a stable HTTPS tunnel domain (e.g. ngrok).

### Localhost dev bypass (recommended for day-to-day coding)

If you don't want to rotate BotFather domains for random tunnel URLs, use the built-in local-only bypass:

```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_TELEGRAM_ID=<your_telegram_id>
DEV_AUTH_FIRST_NAME=Michael
```

- This enables `POST /api/auth/dev-login` and the "Sign in as dev user" button in the login card.
- Route is blocked in production and blocked for non-local hosts unless `DEV_AUTH_BYPASS_ALLOW_NON_LOCAL=true`.
- Keep real Telegram login enabled for production verification.

3. **Render login widget on client**
   - Load `https://telegram.org/js/telegram-widget.js?22`
   - Set `data-telegram-login=<bot_username>`
   - Use `data-onauth="__onTelegramAuth(user)"`
   - Do **not** request `data-request-access="write"` unless you explicitly need the login bot to DM the user. Standard login-only auth should omit it to avoid Telegram confirmation-message prompts that can stall sign-in.

4. **Verify payload on server (must-do)**
   - Parse and validate required fields: `id`, `first_name`, `auth_date`, `hash`.
   - Build `data_check_string` from all fields except `hash`, sorted alphabetically, joined with `\n`.
   - Compute `secret_key = SHA256(bot_token)`.
   - Compute `hex(HMAC_SHA256(data_check_string, secret_key))` and compare with received `hash`.
   - Reject stale `auth_date` (we use a strict 5-minute window).

5. **Establish app session**
   - On successful verification, issue server-signed HttpOnly session cookie.
   - Client refreshes `/api/auth/me`, then resolves/creates Convex user.

### Security checklist

- Never trust Telegram widget payload without server-side hash verification.
- Never expose `TELEGRAM_LOGIN_BOT_TOKEN` or `TELEGRAM_NOTIFY_BOT_TOKEN` to browser/client code.
- Keep `SESSION_SECRET` at least 32 chars and rotate if leaked.
- Use HTTPS in production so cookies stay secure.
- Keep login freshness checks (`auth_date`) to limit replay windows.

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
