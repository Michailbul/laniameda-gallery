# Ticket: WorkOS Auth (Google) + Telegram Account Linking

## Goal

Add WorkOS as a second auth provider (Google OAuth via WorkOS) alongside existing Telegram auth.
Users can link both identities to one account so content is scoped correctly regardless of how they log in.

---

## Background

Current auth is Telegram-only. `ownerUserId` in the schema is the Telegram user ID string.
WorkOS AuthKit supports Google (and others) out of the box and provides a unified user identity.

---

## Scope

### Phase 1 — WorkOS + Google login
- [ ] Install `@workos-inc/node` SDK and `@workos-inc/authkit-nextjs`
- [ ] Add WorkOS env vars: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`, `WORKOS_COOKIE_PASSWORD`
- [ ] Create `/api/auth/workos/callback` route (exchanges code for WorkOS session)
- [ ] Create `/api/auth/workos/login` redirect route
- [ ] Create `/api/auth/workos/logout` route
- [ ] Extend session cookie to carry `{ provider: "telegram" | "workos", userId: string, workosUserId?: string }`
- [ ] Update `middleware.ts` to accept sessions from either provider
- [ ] Add "Sign in with Google" button to the login UI alongside the Telegram button

### Phase 2 — Account linking (Telegram ↔ WorkOS)
- [ ] Add `users` table to Convex schema:
  ```
  users: defineTable({
    telegramUserId: v.optional(v.string()),
    workosUserId: v.optional(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_telegram", ["telegramUserId"])
    .index("by_workos", ["workosUserId"])
  ```
- [ ] On first login (either provider) → upsert a `users` record
- [ ] Linking flow: when logged in via one provider, show "Link [other provider]" option in settings/profile
- [ ] On link: verify second identity, write both IDs to the same `users` doc
- [ ] Resolve canonical `ownerUserId`: prefer `users._id` (Convex doc ID) as the stable owner anchor going forward
- [ ] Migration: existing `assets` and `prompts` with raw Telegram IDs → backfill via a one-time migration action

### Phase 3 — Unified identity in queries
- [ ] Update `listGalleryAssets` / `listPrompts` to resolve `ownerUserId` from the `users` table
- [ ] `KB_OWNER_USER_ID` env var continues to work for agent ingestion (maps to same `users` record)
- [ ] Guest access unchanged

---

## Env vars to add

```bash
WORKOS_API_KEY=...
WORKOS_CLIENT_ID=...
WORKOS_REDIRECT_URI=https://yourdomain.com/api/auth/workos/callback
WORKOS_COOKIE_PASSWORD=...   # 32+ char secret for session encryption
```

---

## Notes

- WorkOS free tier covers up to 1M MAU — no cost concern for personal use
- Keep Telegram login working independently; WorkOS is additive
- `ownerUserId` on raw schema rows should eventually be the Convex `users._id` string (stable across re-links)
- During transition, support both raw Telegram IDs and Convex user IDs as valid owner anchors
