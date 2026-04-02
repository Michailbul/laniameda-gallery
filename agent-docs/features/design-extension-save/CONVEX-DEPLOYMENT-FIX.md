# Convex Deployment Mismatch — Investigation & Fix

## The Problem

`bunx convex dev` was failing with schema validation errors because it was pushing gallery code against the **RunMusic** Convex project instead of the **gallery** project.

The offending document (a RunMusic run with `distanceM`, `routePlanId`, `startWithinRadius`, etc.) has nothing to do with the gallery — it lives in the RunMusic deployment and fails against the gallery's `runs` table schema.

```
Document with ID "jh70zdeqn3hqgth121wkeg0j5n81vdv9" in table "runs"
does not match the schema: Object is missing the required field `createdAt`.

Object: {distanceM: 0.0, durationSec: 2053.0, routePlanId: "k978bt23skmm5dvp4h3k4evnxn81trxt", ...}
```

## Root Cause

Two Convex deployments on the same team account:

| Deployment | Project | Purpose |
|---|---|---|
| `dev:perfect-buffalo-375` | `prompt-storager` | **laniameda.gallery** (correct) |
| `dev:loyal-corgi-868` | `runner-music` | **RunMusic** (wrong) |

`.env.local` had `CONVEX_DEPLOYMENT=dev:loyal-corgi-868` (RunMusic), which overrides the correct value in `.env` (`dev:perfect-buffalo-375`). The Convex CLI also re-writes this line on every `convex dev` run, so manual edits to comment it out kept getting reverted.

### Env file conflict

| File | `CONVEX_DEPLOYMENT` | `CONVEX_URL` |
|---|---|---|
| `.env` | `dev:perfect-buffalo-375` (gallery) | `https://perfect-buffalo-375.convex.cloud` |
| `.env.local` (overrides `.env`) | `dev:loyal-corgi-868` (RunMusic) | `http://127.0.0.1:3210` |

`.env.local` wins in Next.js env loading, so the gallery was always talking to RunMusic's backend.

### Secondary issue

`.env.local` has both `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_URL` set to `localhost:3210`. The Convex CLI detects these as duplicate `CONVEX_URL` variants and prints: `Found multiple CONVEX_URL environment variables in .env.local so cannot update automatically.`

## What Was Tried

1. **Commented out `CONVEX_DEPLOYMENT` in `.env.local`** — Convex CLI re-added it on next run, reverting to RunMusic.

2. **Made gallery schema permissive** to accommodate RunMusic data (`createdAt` optional, `"finished"` status, etc.) — schema validated, but then hit `Object contains extra field 'distanceM'` because Convex strict validation rejects unknown fields. Would have required making the entire `runs` table schema-less, which defeats the purpose.

3. **Tried deleting the RunMusic document** via `bunx convex run` — the deployment only had RunMusic functions registered (no `deleteRunById`), so no way to delete from CLI.

4. **Overrode deployment via env var on the command line:**
   ```bash
   CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex dev --once --url https://perfect-buffalo-375.convex.cloud
   ```
   This worked — pushed successfully to the gallery deployment.

5. **Fixed `.env.local`** to point `CONVEX_DEPLOYMENT` to `dev:perfect-buffalo-375`. The Convex CLI then persisted this correct value on subsequent runs.

## Current State

- `.env.local` now has `CONVEX_DEPLOYMENT=dev:perfect-buffalo-375` (gallery)
- `bunx convex dev --once` succeeds against the gallery deployment
- All gallery functions (including `tags:listTags`, `designInspirations:listDesignGalleryEntries`, new design save functions) are deployed
- Schema changes reverted to strict (no RunMusic accommodations needed)
- Duplicate literal cleanup in `runs.ts` validators (`creator_assist` x2, `canvas` x2) — kept

## Remaining Concern

The `CONVEX_URL` / `NEXT_PUBLIC_CONVEX_URL` in `.env.local` still point to `localhost:3210`. This means:
- **Next.js app** connects to local Convex backend (needs `bunx convex dev` running)
- **Cloud deployment** (`perfect-buffalo-375`) has the functions pushed but the app won't use it unless you either:
  - Change `.env.local` URLs to `https://perfect-buffalo-375.convex.cloud`, or
  - Run `bunx convex dev` locally so `localhost:3210` serves the same functions

For local dev, running `bunx convex dev` is the intended workflow — it syncs functions to cloud AND runs a local backend.
