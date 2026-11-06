# Backlog — laniameda.gallery

> Single source of truth for all work items.
> Statuses: `🔥 active` | `✅ ready` | `📋 backlog` | `🧊 icebox` | `✔ done`

Last updated: 2026-11-05 (reconciled against the code and PROGRESS.md)

---

## Legend

| Field | Values |
|---|---|
| **Priority** | P0 critical · P1 high · P2 medium · P3 low |
| **Effort** | XS < 2h · S 2-4h · M 4-8h · L 1-2d · XL 2-5d |
| **Detail** | link to ticket/PRD file |

Open work for agents lives on the gallery task board (`/tasks`, MCP `list_tasks`). This file keeps only the long-lived engineering backlog.

---

## 🔥 Active

None queued. The 5 Nov board had no code-fix tasks; the one engineering item is the inspiration-draft vertical slice below.

## 📋 Backlog — Defined but not yet scheduled

| ID | Title | P | Effort | Notes |
|----|-------|---|--------|-------|
| INS-01 | Inspiration drafts: original, adaptation draft, versions, feedback, promotion | P2 | XL | Task `td72c1jd` on /tasks. Claude CLI opus 5.5 only, Friday 6 Nov or later. Gates: private original delivery before personal uploads; drafts excluded from production search and reference selection; unknown paid outcomes never auto-resubmit. Design: gallery skill `qh79d2sg…`/`qh797xrk…` (critique). |
| SP-01 | Replace the remaining inline hover handlers with CSS | P3 | S | 6 Nov: the four style-only handlers (panel and modal close buttons, upload submit, bottom menu) are CSS now. Left: `pack-grid` cards keep a hover state that drives the carousel and copy pill; the rest are behaviour (prompt sheet, previews, video play). |
| SP-04–07, 09–13 | Dashboard polish remainder | P3 | M | Written 27 Feb and not re-audited. The grid, sidebar, tabs and toolbar were rebuilt since (see PROGRESS.md Nov entries). Re-audit before starting any of them. |
| AI-01 | Image → Prompt generator (button on images with no prompt) | P2 | L | Partial: `convex/agentDescriptions.ts` writes agent descriptions; no prompt-reversal button in the UI. |
| AI-02/03 | Image Focus Mode Phase 2/3 (transitions, preloading, related prompts) | P3 | M | PRD `features/image-focus-mode/PRD.md`. Keyboard nav and swipe from Phase 1 are done; the rest is open. |
| UI-02–04 | Prompt provenance tab, tab state across images, related tags/prompts | P3 | XS–L | IFM PRD open questions. |
| INF-02 | Telemetry hooks (copy/action funnel) | P3 | S | Nothing built. |

## 🧊 Icebox

Nothing live. Superseded items are listed under Dropped.

## ✔ Done (since the August backlog)

| ID | Title | Where |
|----|-------|-------|
| EXT-01 | Browser extension: web saves, file/folder drop desk | 2026-08-13 |
| IFM-01–06 | Image Focus Mode Phase 1 | 2026-02-27 · `features/image-focus-mode/TICKETS-PHASE1.md` |
| SP-02 | Shadow/elevation tokens (`--shadow-sm/md/lg/sharp`) | `app/globals.css` |
| SP-03 | Swipe gestures on the mobile detail sheet and packs | PROGRESS 2026-10-09, 2026-10-29 |
| SP-08 | Copy feedback toast | `components/ui/coral-toast.tsx` |
| AI-04 | Auto-tagging on ingest | Jev classifier, PROGRESS 2026-11-02 (a vision classifier, not embedding neighbours) |
| AI-05 | Smart clustering | Group similar by perceptual hash, PROGRESS 2026-10-21 (not embedding k-means) |
| INF-01 | Deployment pipeline | Vercel on merge to main; Convex cloud `dev:perfect-buffalo-375` |
| ICE-01 | Video support | Hover scrub, posters, R2 video migration |
| ICE-02 | Public share links | Public worlds `/w/<slug>`, selected-work pages |
| ICE-03 | Collections / manual curation | Worlds, shelves, one-level collections |
| UI-05 | Gallery entry V2 (hover actions, side-panel carousel, prompt/image arrays) | Packs, expanded view, PROGRESS 2026-10-09 |
| — | Tests green again: skills ported off `convex/workflows`, mock leaks fixed | #146, 2026-11-05 |

## ✖ Dropped (superseded)

| ID | Why |
|----|-----|
| ING-01, ING-02 | Pillars are retired; agents file through collections and tags. |
| ING-03 | The Telegram webhook route was removed; ingest is OpenClaw → Convex action. |
| UI-01 | Pillar-aware theming has no pillars to follow. |
| UI-06 | Designs Pillar became tags on ordinary assets and Skills. |

---

## Harness 1.1 (from the 23 Oct critic round)
- Archive/delete for shelves and storybooks as journaled world operations; restore a doc to revision N.
- Journal deletes (assets, stories, collections) and character edits.
- open_world: `include` parameter; a leak count without a full scan.
- Plugin: drop rules duplicated from the live skill; avoid double MCP registration inside this repo.
- Michael's calls: owner of the 31 two-world assets; Art Deco as its own world or a style branch; register the five established Dear Annete characters; archive the old Dear Annete world guide.

## Morning newspaper (30 Oct 2026)

One edition a day at `/newspaper` (cron 05:30 UTC, MCP `get_newspaper` / `write_newspaper` / `compile_newspaper`): per world what changed and was saved, tasks done and blocked, open Inbox stacks, a "Needs you" list, the agent's prose. PRD on branch `feat/newspaper`, `agent-docs/features/newspaper/PRD.md`.

## Tasks queue (29 Oct 2026)

The agent task queue (`/tasks`, MCP `list_tasks` … `comment_task`): owner comments and Inbox answers become tasks; agents claim and complete. PRD on branch `feat/tasks-queue`, `agent-docs/features/tasks-queue/PRD.md`.
