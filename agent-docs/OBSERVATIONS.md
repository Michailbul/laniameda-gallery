# Observations

Last updated: 2026-01-28

- Added `.env.example` and Tailwind token config for the design system.
- Gallery UI now consumes Convex assets/tags/search instead of mock data.
- Local dev ingest seeds Convex storage from `public/images-test` with thumbnails.
- Masonry layout uses CSS columns and reserves aspect ratio to stabilize layout.
- Added modal preview with progressive thumb → full-res swap.
- ESLint warnings persist in `convex/_generated/*` and `<img>` usage warnings in gallery.
- Running `bun run build` currently fails because Turbopack/Next.js cannot download the Nunito Sans font (network blocked); repeated runs also hit `Operation not permitted (os error 1)` when Turbopack tries to spawn its CSS worker, so rerun it once you can bind ports again.
- WorkOS AuthKit integration is wired with middleware/auth routes and Convex’s `auth.config.ts`, so the gallery is gated behind authentication (set `NEXT_PUBLIC_WORKOS_CLIENT_ID`/`NEXT_PUBLIC_WORKOS_REDIRECT_URI` locally or via your deployment provider).
- The WorkOS redirect URI must match exactly between the dashboard, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, and the `/callback` route (e.g., `http://localhost:3000/callback` for dev). Keep local values in `.env.local` and update the hosted env when you deploy; WorkOS lets you register multiple redirect URIs so you can include both dev and prod.
- `bun convex dev` still requires external network access (Convex hits `o1192621.ingest.sentry.io`, so re-run the push from a networked machine and set `WORKOS_CLIENT_ID` in the Convex dashboard before pushing).
- The ingestion action uses the `Jimp` class and `JimpMime` exports (auto/resize/mime detection) rather than relying on named CommonJS exports, which keeps os-specific binaries out of the bundle.
- The gallery now renders for everyone; `app/page.tsx` always mounts `GalleryDashboard` and shows the `AuthBanner` when unauthenticated, so visitors can browse before they decide to sign in.
- Manual ingestion work is next: we need a UI that accepts prompt text, uploads, URLs, and tag/meta inputs, and tests to prove `/api/ingest` handles prompt-only, file-only, and remote URL payloads before the agent automation layers on top.
