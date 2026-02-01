# Progress

Last updated: 2026-02-01

## Done
- Drafted PRD, TODO, and PROGRESS documents
- Added Convex schema for assets, prompts, tags, folders, and join tables
- Implemented core mutations and queries for assets/prompts/tags/folders
- Implemented ingestion action (URL/file/prompt) with idempotency
- Added `/api/ingest` route and ingest helpers
- Added basic ingest helper tests
- Integrated the new gallery dashboard UI and theme (static data)
- Added `.env.example` for Convex + AI provider keys
- Added Tailwind token configuration for colors, spacing, and radii
- Wired gallery UI to Convex assets/tags/search
- Added gallery detail modal with progressive full-res load
- Added local dev ingest for images-test with Convex storage + thumbnails
- Updated the ingestion action so API uploads auto-resize and store 520px thumbnails, ensuring gallery cards always surface lightweight previews.
- Hardened image loading in the grid and modal by switching to `next/image`, responsive sizing, and improved skeleton/progressive loading states.
- Replaced the server-side thumbnail resize code with the pure-JS `jimp` helper so Convex’s linux-arm64 runtimes can bundle the ingest action without native sharp dependencies.
- Reworked `convex/ingest.ts` to use Jimp’s modern resize/getBuffer API and to create thumbnail blobs from safe ArrayBuffers so TypeScript/edge runtimes stop erroring.
- Added WorkOS AuthKit integration, new middleware/auth routes, and Convex auth config so the gallery is gated behind authenticated users.
- Allowed the masonry gallery to render for everyone while showing the new `AuthBanner` CTA so visitors can browse before signing in.
- Built the manual upload experience (drag-and-drop dropzone, prompt/URL inputs, tags/folder metadata, and API wiring) along with focused tests that validate the ingestion payload.

## In Progress

## Next Up
- Add copy‑prompt button with feedback
- Extract image dimensions and richer metadata for remote ingestion
- Add pagination/infinite scroll to the gallery

## Risks / Questions
- Which external sources must the URL fetcher support first?
- Do we need hard limits on file size or type at MVP?
- Should prompts be editable in place or only in a detail view?
