# TODO

## 0) Project Setup
- [x] Confirm Next.js 16.1 app scaffold and directory layout
- [x] Add .env.example with Convex + AI provider keys
- [x] Configure Tailwind tokens (colors, spacing, radii)

## 1) Convex Data Layer
- [x] Define schema for assets, prompts, tags, folders
- [x] Add indexes for tag lookup, folder filters, and search
- [x] Implement queries for gallery, filters, and search
- [x] Implement mutations for create/update tags, folders, prompts

## 2) Ingestion Agent
- [x] Create /api/ingest endpoint (files, prompt text, URLs)
- [x] Add URL fetch tool (basic) and ingest helpers
- [x] Store files via Convex file storage and link metadata
- [x] Add simple tag suggestion heuristics
- [x] Ensure idempotency for ingestion requests
- [x] Extract image dimensions and richer metadata
- [x] Generate and store 520px thumbnails for ingested images
- [x] Modernize thumbnail resizing/storage flow to use the updated `jimp` API and typed blobs
- [ ] Harden ingest action with unit tests that cover prompt-only, file-only, and URL inputs
- [x] Build a manual ingest UI (upload area, prompt field, tag entry, URL paste) that posts to `/api/ingest`
- [x] Add structured tag/folder selection to the manual UI so metadata mirrors what the agent will expect

## 3) Frontend UI
- [x] Build GalleryCard component (variants: reference, generated, prompt)
- [x] Implement gallery page with filters and search (wire to Convex data)
- [x] Add detail view (modal or side panel)
- [x] Improve image loading UX/performance (Next.js Image, responsive layouts, skeletons)
[ ] Add copy-prompt button with feedback
- [x] Add upload dropzone and URL input
- [x] Expose manual tag/folder selection in the upload experience so the agent can learn from structured data

## 4) Quality
- [x] ESLint + TypeScript checks pass (warnings only)
- [ ] Unit tests for Convex functions
- [x] Basic helper tests (ingest helpers)
- [ ] Integration tests for ingestion + gallery
- [ ] Accessibility pass for keyboard and screen readers
- [ ] Rerun `bun run build` once Turbopack can spawn its CSS worker (currently blocked by `Operation not permitted (os error 1)`)

## 5) Documentation
- [ ] Expand README with setup and scripts
- [ ] Add API docs for /api/ingest
- [ ] Add deployment notes for Vercel + Convex

## 6) Housekeeping
- [x] Add completed admin test task for TODO flow (2026-01-28)

## 7) Authentication
- [x] Configure WorkOS AuthKit routes/middleware and Convex auth config
- [x] Wrap the app with `AuthKitProvider` + `ConvexProviderWithAuthKit` and gate the gallery behind `<Authenticated>`
