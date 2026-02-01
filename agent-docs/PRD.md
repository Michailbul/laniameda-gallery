# Agent Prompter — Product Requirements Document

## 1) Summary
Agent Prompter is a desktop‑first web app for creative AI studios to store, organize, and reuse prompts and media. It pairs a Convex backend with an ingestion agent (Vercel AI SDK) and a gallery‑style UI. The system ingests images, videos, and prompt text, extracts metadata, suggests tags, and makes everything searchable and shareable.

## 2) Goals
- Centralize prompts, reference media, and generated assets in one place.
- Automate ingestion: download remote media, extract metadata, and store files.
- Enable fast browse, filter, and search by tags and prompt text.
- Deliver a clean, gallery‑first UI optimized for desktop.
- Use an architecture that can evolve to new model providers and tools.

## 3) Non‑Goals (MVP)
- Mobile‑first experience.
- End‑to‑end generation pipeline editor (yet) 

## 4) Target Users
- Creative AI teams storing prompts and reference media.
- Producers curating inspiration boards.
- AI developers testing prompts and assets.

## 5) User Stories (MVP)
- As a user, I can drag‑and‑drop images and paste prompts into the app.
- As a user, I can paste a URL and have the agent fetch the media.
- As a user, I can view assets in a gallery, filter by tag, and search by text.
- As a user, I can open a detail view and copy the full prompt.
- As a user, I can tag and organize assets into folders.
- As a user, i can text to telegram bot iwth the video/url/image/prompt or image+prompt, with description /instructions and then see the sorted data in the dashbord frontend web app

## 6) Functional Requirements
### 6.1 Ingestion
- Accept file uploads, prompt text, and URLs.
- Detect input type and download remote media when needed.
- Extract metadata: file type, dimensions, size, source URL, and timestamps.
- Store media using Convex file storage and link to metadata.
- Store prompts as first‑class records that can exist without media.

### 6.2 Organization & Search
- Tagging for assets and prompts.
- Folder‑like groupings (manual assignment).
- Full‑text substring search on prompt text and tags.
- Filters: tag, folder, type, date added.

### 6.3 UI & UX
- Gallery view with cards (thumbnail, prompt snippet, tags, copy button).
- Detail view (modal or side panel) with full prompt, media, and metadata.
- Clean, minimal layout with generous spacing and subtle hover states.
- Desktop‑first responsiveness; mobile not required.

## 7) Non‑Functional Requirements
- Real‑time updates via Convex reactive queries.
- Type‑safe APIs with validators for all Convex functions.
- Secure uploads and file validation (type/size limits).
- Accessible UI (keyboard navigation, labels, focus states).

## 8) Architecture & Tech Decisions
- Frontend: Next.js 16.1 (App Router), TypeScript, Tailwind CSS.
- Backend: Convex (queries, mutations, actions) with file storage.
- Agent: Vercel AI SDK for tool calling and model abstraction.
- Design system: shadcn/ui with class‑variance‑authority variants.
- Package manager/runtime: Bun.

## 9) Data Model (High‑Level)
- assets: media records (fileId, type, dimensions, sourceUrl, promptId, tags, folderId).
- prompts: prompt text records (text, tags, folderId, linked asset ids).
- tags: reusable tag records (name, usageCount).
- folders: folder records (name, description).

## 10) API Surface (MVP)
- POST /api/ingest — accepts files, prompt text, or URLs; enqueues ingestion.
- Convex queries for gallery, filters, and search.
- Convex mutations for tags, folders, and prompt edits.

## 11) Success Metrics (MVP)
- Ingestion succeeds for common image types and URLs.
- Users can find assets via tags or text search in under 3 steps.
- Copy‑prompt interaction works on all cards.

## 12) Risks & Open Questions
- Remote media download reliability (rate limits, blocked sources).
- Tag suggestion quality with simple heuristics.
- File size and storage cost management.

## 13) Milestones (Draft)
- M1: Schema + ingestion action + file storage.
- M2: Gallery UI + search + tags.
- M3: Detail view + edit flow + polish.
- M4: Basic tests + deployment docs.

## 14) Status Notes (2026-01-31)
- Gallery UI shell integrated with a dark theme and masonry grid layout (mock data).
- Image loading UX/performance improved by switching gallery cards and the preview modal to `next/image`, responsive sizing, and stronger skeleton/progressive loading states that guard the masonry layout plus memoized “loaded” tracking so revisiting the tab doesn’t reshow skeletons.
- Ingestion now normalizes uploaded images with `sharp`, records dimensions/size metadata, and stores 520px thumbnails (Convex records keep `thumbStorageId`/`thumbUrl` so the gallery always serves lightweight previews without an external CDN yet).
- Verified lint/test/UX changes locally but `bun run build` remains blocked inside this environment because Turbopack cannot spawn its CSS worker (it attempts to bind a port and is denied with `Operation not permitted (os error 1)`); rerun once a less-restricted host is available.
