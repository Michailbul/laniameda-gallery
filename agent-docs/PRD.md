# Laniameda AI UGC — Product Foundation PRD

Last updated: 2026-02-19

## 1) Product Summary
Laniameda AI UGC is a desktop-first repository and workflow workspace for **UGC / AI influencer image creation**.
The product removes context switching between folders, chat apps, and generation tools by combining:
- a reference-image dashboard,
- fast smart filters,
- one-click creative transforms (style, pose, character swap),
- agent-assisted prompt construction,
- optional in-app execution and organized outputs.

## 2) Product Principles
1. **Frontend and UX are the moat.** Speed, clarity, and low click count win.
2. **Backend supports UX, not the other way around.** Build only the backend needed to unlock the next UX milestone.
3. **Agentic workflows are the core backend strategy.** Use AI SDK (AI Gateway) for short web jobs and Agent SDK worker for heavy Telegram jobs.
4. **Images only for MVP.** Video is out of scope.
5. **Telegram is a required integration surface.** Users must be able to trigger agent workflows from Telegram.

## 3) In Scope (MVP+)
- UGC/influencer reference image library.
- Gallery dashboard with fast browse and smart filtering.
- “Few-click aha” actions on reference cards:
  - Transfer style
  - Transfer pose
  - Replace character
- Prompt package output (text + referenced files) for export to external tools.
- Optional in-app execute flow in a separate working panel/sidebar.
- Ingestion from user uploads, pasted URLs, and integrations (Telegram first).
- Telegram as bidirectional channel: inbound trigger + outbound agent response.

## 4) Out of Scope (Current)
- Video ingestion, tagging, generation, or editing.
- Full node-based pipeline builder.
- Mobile-first UI.

## 5) Primary User Jobs
- Find high-quality reference images quickly.
- Turn references into usable generation instructions with minimal thought overhead.
- Reuse their own character assets consistently.
- Collect references from external channels and auto-organize them in one library.

## 6) Core User Flows
### Flow A: Reference-to-Prompt (Few Clicks)
1. User opens dashboard and filters references.
2. User selects an image and clicks one transform action.
3. User selects target character (from saved characters/assets).
4. Agent constructs a structured prompt package.
5. User either:
   - downloads prompt + files for external tools, or
   - clicks execute and continues in the in-app work panel.

### Flow B: External Ingest (Telegram First)
1. User sends image/URL/prompt to Telegram bot.
2. Ingest agent classifies content, extracts metadata, and tags/folders it.
3. User logs into dashboard and sees organized assets in the correct library context.

### Flow C: Save Any Reference From Chat
1. User sees a good prompt, tutorial, or image reference somewhere online.
2. User forwards/shares it to Telegram bot with optional instruction text.
3. Agent decides ingestion strategy:
   - extract prompt + media bundle from tutorial source, or
   - extract image description/style metadata for inspiration/recreation.
4. Agent stores normalized results in Convex with tags/style metadata.
5. User opens dashboard and can browse/copy/reuse immediately.

## 7) Functional Requirements
### 7.1 Frontend/UX (Priority Track)
- Gallery-first dashboard optimized for rapid visual scanning.
- Smart filter UX with low friction and high discoverability.
- Card-level quick actions for style/pose/character workflows.
- Sidebar or split-panel workspace for generated results and run history.
- Minimal-click export of prompt package (prompt + file references).

### 7.2 Backend/Agents (Enablement Track)
- Prompt construction agent using Anthropic Agents SDK and skill-driven tasks.
- Ingestion agent that accepts uploads/URLs/integration payloads.
- Metadata extraction and deterministic tagging/folder placement.
- Execution pipeline adapters for in-app generation providers.
- Telegram-connected agent that can crawl/extract from media and links, then persist structured records via tool calls into Convex.

### 7.3 Data and Library
- Asset records with metadata, tags, folders, and provenance.
- Prompt records linked to references and output artifacts.
- User-specific character library for reusable identity consistency.

## 8) Non-Functional Requirements
- Fast first interaction on dashboard and filters.
- Idempotent ingest and agent operations.
- Observable agent runs (status, errors, source payload, outputs).
- Accessible keyboard navigation and screen-reader-friendly controls.

## 9) Tech Stack
- Frontend: Next.js App Router, TypeScript, Tailwind, shadcn/ui.
- Backend: Convex (queries/mutations/actions, storage).
- AI runtime:
  - AI SDK + AI Gateway for short-lived web workflows.
  - Anthropic Agents SDK in external worker for heavy Telegram workflows.
- Runtime/package tooling: Bun.

## 10) Implementation Foundation
1. Telegram inbound update is normalized to a common internal envelope.
2. Media is downloaded, validated, and staged into run sandbox workspace.
3. Run is persisted in Convex (`runs`, `run_events`, `run_artifacts`) with source `telegram`.
4. Agent SDK run executes in worker with sandbox enabled and scoped tool access.
5. Agent uses tool calls to store extracted prompts/references/tags in Convex.
6. User sees real-time run status and resulting data in dashboard.
7. Bot returns final response to Telegram thread.

Current state against this foundation:
- Implemented now: 1, 2, 3, 4, 7.
- Partial: 6 (backend run ledger is ready; full dashboard work-panel integration still in progress).
- Not yet implemented: 5 (agent tool-calls that persist extracted data into library tables).

## 11) OpenClaw Patterns To Reuse
1. Provider-specific payload -> normalized inbound context.
2. Attachment staging into sandbox-local paths before execution.
3. Session/thread mapping strategy for DM/group/topic continuity.
4. Event-driven run pipeline with terminal-state guarantees.
5. Runtime separation between transport (Telegram) and agent execution.

## 12) Success Metrics
- User can go from reference discovery to ready prompt package in a few clicks.
- User can find useful references in under 3 interactions with filters/search.
- Ingested external assets are auto-organized with high precision.
- Reduced tab switching compared with baseline current workflow.

## 13) Known Gaps and Open Questions
- Ranking quality for “best references first” in smart filters.
- Tagging taxonomy drift across users and content styles.
- Quality and reliability of source integrations (Telegram first).
- Execution provider abstraction design (single provider vs pluggable).
- Source ownership/licensing policy for crawled references and tutorial extraction.
- Conflict-resolution policy when agent is unsure whether content should be stored as prompt, reference, tutorial set, or both.
- Definition of “free user browse limits” (if any) and gating points for paid features.

## 14) Delivery Strategy
We deliver in two explicit tracks:
1. **Track A: Frontend/UX and Design System**
2. **Track B: Backend/Agents and Integrations**

Rule: Track B work should be scoped to unblock Track A milestones.

## 15) Linked Specs
- Technical architecture map: `agent-docs/TECHNICAL_OVERVIEW.md`
- Backend runtime baseline: `agent-docs/BACKEND_PRD.md`
- Convex setup/runtime map: `agent-docs/BACKEND_CONVEX_SETUP.md`
- Worker deployment runbook: `agent-docs/DEPLOYMENT_AGENT_WORKER.md`
- Telegram engineering contract: `agent-docs/TELEGRAM_AGENT_ENGINEERING_PRD.md`
- Editable diagrams: `agent-docs/TELEGRAM_AGENT_DIAGRAMS.md`

## 16) Immediate Build Focus (Current)
Primary focus for the next build session:
1. Implement agent tool-calling that writes extracted content into Convex domain tables (`prompts`, `assets`, tags/folders).
2. Keep Telegram streaming path stable while adding richer multimodal handling for audio/video/voice.
3. Connect run ledger outputs to dashboard workspace UX (realtime status + artifact rendering).
4. Optimize worker startup latency (reduce repeated sandbox bootstrapping overhead).
