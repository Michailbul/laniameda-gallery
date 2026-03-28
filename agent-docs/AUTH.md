# Auth — laniameda.gallery

Last updated: 2026-03-17

## Current model

- Auth is Telegram-only.
- The browser authenticates with the Telegram login widget.
- Next.js owns the session via an HttpOnly `tg_session` cookie.
- Convex user rows are resolved or created on the server from the Telegram session.
- Private gallery access goes through Next API routes, not direct client-side Convex calls.

## Runtime flow

1. The Telegram widget redirects to `/api/auth/telegram?returnTo=...` with the signed Telegram payload.
2. The server verifies the Telegram payload hash with `TELEGRAM_LOGIN_BOT_TOKEN`.
3. On success, the server writes the signed session cookie and redirects back to the requested page.
4. The client calls `GET /api/auth/me`.
5. `/api/auth/me` resolves or creates the matching Convex `users` row and returns the app user.
6. Protected routes call `requireAppUser()` and use `ownerUserId` server-side when querying or mutating Convex.

## Visibility rules

- Guests can browse public gallery content.
- Signed-in users can browse their own gallery and perform protected actions.
- Protected actions include ingest, delete, folder assignment, canvas position sync, and private semantic search.

## Required env vars

```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
SESSION_SECRET=...                    # 32+ chars
TELEGRAM_LOGIN_BOT_TOKEN=...
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=...
```

Convex-only runtime:

```bash
TELEGRAM_NOTIFY_BOT_TOKEN=...         # "saved" notifications
```

Agent and CLI ingestion:

```bash
KB_OWNER_USER_ID=...                  # canonical owner for OpenClaw skill
LOCAL_INGEST_OWNER_USER_ID=...        # optional override for local ingest script
```

## Local dev bypass

Use the built-in bypass when you do not want to rotate BotFather domains for temporary tunnels:

```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_TELEGRAM_ID=<your_telegram_id>
DEV_AUTH_FIRST_NAME=Michael
```

- This enables `POST /api/auth/dev-login`.
- It is blocked in production.
- It is blocked for non-local hosts unless `DEV_AUTH_BYPASS_ALLOW_NON_LOCAL=true`.

## Production checklist

- Set the production app domain in BotFather with `/setdomain`.
- Keep a single Telegram-approved production host and redirect other Vercel aliases to it.
- Keep `SESSION_SECRET` at 32+ chars.
- Use HTTPS so the auth cookie stays secure.
- Keep `NEXT_PUBLIC_TELEGRAM_REQUEST_ACCESS` unset unless the login bot must DM the user.
- Keep `TELEGRAM_LOGIN_BOT_TOKEN` and `TELEGRAM_NOTIFY_BOT_TOKEN` server-only.

Optional host config:

```bash
APP_CANONICAL_HOST=laniameda-galery.vercel.app
```

- Use this when production can be reached from multiple Vercel aliases. Telegram auth is origin-bound, so unregistered aliases should 308-redirect to the canonical host before rendering the widget.

## Key files

| File | Purpose |
|---|---|
| `lib/telegram-auth.ts` | Telegram payload verification and session cookie helpers |
| `lib/server/app-user.ts` | Resolve current session to Convex `users` row |
| `components/TelegramAuthProvider.tsx` | Client auth state sourced from `/api/auth/me` |
| `app/api/auth/telegram/route.ts` | Telegram login callback |
| `app/api/auth/me/route.ts` | Current authenticated app user |
| `app/api/auth/logout/route.ts` | Session teardown |
| `convex/users.ts` | Convex user lookup and creation |
