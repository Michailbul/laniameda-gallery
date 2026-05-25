export type ReviewSeverity = "critical" | "high" | "medium" | "note";

export type ReviewTableGroup = "content" | "search" | "operations";

export type ReviewStatus = "solid" | "mixed" | "gap";

export interface ReviewStrength {
  title: string;
  detail: string;
  source: string;
}

export interface ReviewTable {
  name: string;
  group: ReviewTableGroup;
  purpose: string;
  ownership: string;
  keyFields: string[];
  indexes: string[];
  relationships: string[];
  source: string;
}

export interface ReviewPillar {
  pillar: "creators" | "designs" | "dump";
  accent: string;
  summary: string;
  primaryRecords: string[];
  promptProfileFields: string[];
  metadataFocus: string[];
  note: string;
}

export interface ReviewFlowStep {
  label: string;
  detail: string;
  source: string;
}

export interface ReviewFlow {
  title: string;
  summary: string;
  steps: ReviewFlowStep[];
}

export interface ReviewSkillArtifact {
  name: string;
  role: string;
  source: string;
}

export interface ReviewAuthLayer {
  title: string;
  status: ReviewStatus;
  detail: string;
  source: string;
}

export interface ReviewFinding {
  severity: ReviewSeverity;
  title: string;
  summary: string;
  impact: string;
  evidence: string[];
  recommendation: string;
}

export interface ReviewTrack {
  phase: "Now" | "Next" | "Later";
  items: string[];
}

export interface ReviewQuestion {
  title: string;
  detail: string;
}

export interface ReviewSourceDoc {
  path: string;
  purpose: string;
}

export const backendReview = {
  reviewedOn: "2026-03-15",
  title: "Laniameda Gallery Backend Review",
  summary:
    "A repo-backed architecture review of the current gallery schema, ingest contracts, skill surface, auth boundary, and the main issues that should be tightened before the backend is treated as hardened.",
  strengths: [
    {
      title: "Idempotent ingest exists across the main content types",
      detail:
        "Prompt, asset, and design inspiration creation all guard on owner-scoped ingest keys and return existing ids when the same item is retried.",
      source: "convex/ingest.ts, convex/prompts.ts, convex/assets.ts, convex/designInspirations.ts",
    },
    {
      title: "The schema is strongly validated and heavily indexed",
      detail:
        "The main tables use explicit validators for pillars, prompt profiles, workflows, asset roles, semantic search metadata, and indexed access patterns for common filters.",
      source: "convex/schema.ts, convex/validators.ts",
    },
    {
      title: "Skill contract lives in the repo instead of a drifting external copy",
      detail:
        "The canonical gallery skills, their schema contract notes, and example payloads are checked into the repo and meant to ship in lockstep with ingest and query changes.",
      source: "skills/laniameda-gallery-ingest/SKILL.md, skills/laniameda-gallery-ingest/references/*, skills/laniameda-gallery-query/SKILL.md",
    },
    {
      title: "Semantic indexing is decoupled from the write path",
      detail:
        "Create and update flows schedule asynchronous reindex work instead of blocking the ingest path on embeddings.",
      source: "convex/prompts.ts, convex/assets.ts, convex/designInspirations.ts, convex/semanticIndex.ts",
    },
    {
      title: "Failure observability already exists",
      detail:
        "Ingest failures and semantic indexing failures have dedicated tables that make retries and audits possible.",
      source: "convex/ingest_failures.ts, convex/schema.ts",
    },
  ] satisfies ReviewStrength[],
  tables: [
    {
      name: "users",
      group: "operations",
      purpose: "Maps external identities to the gallery's ownerUserId namespace.",
      ownership: "Global auth-adjacent data.",
      keyFields: ["telegramId", "workosUserId", "email", "ownerUserId", "name", "avatarUrl"],
      indexes: ["by_telegramId", "by_workosUserId", "by_email", "by_ownerUserId"],
      relationships: ["Referenced indirectly by ownerUserId across prompts, assets, folders, and runs."],
      source: "convex/schema.ts, convex/users.ts",
    },
    {
      name: "tags",
      group: "content",
      purpose: "Normalized tag catalog with metadata about category, pillar, and source.",
      ownership: "Shared metadata with optional pillar scoping.",
      keyFields: ["name", "normalized", "usageCount", "category", "pillar", "source", "aliases"],
      indexes: ["by_normalized", "by_category_normalized", "by_pillar_category_normalized"],
      relationships: ["Joined to prompts, assets, and designInspirations through dedicated join tables."],
      source: "convex/schema.ts, convex/tags.ts",
    },
    {
      name: "folders",
      group: "content",
      purpose: "Owner-scoped grouping for prompts, assets, and design inspirations.",
      ownership: "Private per ownerUserId.",
      keyFields: ["ownerUserId", "name", "normalizedName", "description", "createdAt", "updatedAt"],
      indexes: ["by_name", "by_owner_normalizedName", "by_owner_createdAt"],
      relationships: ["Referenced by prompts.folderId, assets.folderId, and designInspirations.folderId."],
      source: "convex/schema.ts, convex/folders.ts",
    },
    {
      name: "prompts",
      group: "content",
      purpose: "Stores prompt text plus structured metadata for all four pillars.",
      ownership: "Private per ownerUserId.",
      keyFields: [
        "ownerUserId",
        "text",
        "tagIds",
        "folderId",
        "ingestKey",
        "pillar",
        "promptType",
        "workflowType",
        "domain",
        "modelName",
        "modelProvider",
        "promptSections",
        "promptProfile",
      ],
      indexes: [
        "by_owner_ingestKey",
        "by_owner_folder_createdAt",
        "by_owner_pillar_createdAt",
        "by_owner_pillar_promptType_createdAt",
        "by_owner_modelName_createdAt",
        "search_text",
      ],
      relationships: ["assets.promptId", "designInspirations.promptId", "promptTags.promptId", "semanticDocuments.promptId"],
      source: "convex/schema.ts, convex/prompts.ts",
    },
    {
      name: "assets",
      group: "content",
      purpose: "Stores media files, URLs, curation state, and prompt/design links.",
      ownership: "Private by default; public exposure is explicit via curation fields.",
      keyFields: [
        "ownerUserId",
        "kind",
        "storageId",
        "thumbStorageId",
        "sourceUrl",
        "promptId",
        "designInspirationId",
        "tagIds",
        "folderId",
        "ingestKey",
        "modelName",
        "isPublic",
        "isFeatured",
        "pillar",
        "generationType",
        "assetRole",
        "ingestSource",
      ],
      indexes: [
        "by_owner_ingestKey",
        "by_owner_prompt_createdAt",
        "by_owner_folder_createdAt",
        "by_owner_kind_createdAt",
        "by_owner_pillar_createdAt",
        "by_isPublic_createdAt",
        "by_isPublic_kind_createdAt",
        "by_isPublic_pillar_createdAt",
        "by_owner_modelName_createdAt",
        "by_owner_assetRole_createdAt",
      ],
      relationships: ["prompts", "designInspirations", "assetTags", "semanticDocuments", "canvasPositions"],
      source: "convex/schema.ts, convex/assets.ts",
    },
    {
      name: "designInspirations",
      group: "content",
      purpose: "Richer non-prompt reference model for the designs pillar.",
      ownership: "Private per ownerUserId.",
      keyFields: [
        "ownerUserId",
        "pillar",
        "title",
        "summary",
        "sourceUrl",
        "sourceDomain",
        "searchText",
        "inspirationType",
        "platform",
        "workflowType",
        "status",
        "tagIds",
        "folderId",
        "ingestKey",
        "assetId",
        "promptId",
      ],
      indexes: [
        "by_owner_ingestKey",
        "by_owner_promptId",
        "by_owner_inspirationType_createdAt",
        "by_owner_platform_createdAt",
        "by_owner_workflowType_createdAt",
        "by_owner_folder_createdAt",
        "by_owner_sourceDomain_createdAt",
        "search_text",
      ],
      relationships: ["assets.designInspirationId", "designInspirationTags.designInspirationId", "semanticDocuments.designInspirationId"],
      source: "convex/schema.ts, convex/designInspirations.ts",
    },
    {
      name: "promptTags / assetTags / designInspirationTags",
      group: "content",
      purpose: "Join tables for tag fan-out and reverse lookups.",
      ownership: "Derived from the parent records.",
      keyFields: ["promptId | assetId | designInspirationId", "tagId", "createdAt"],
      indexes: ["by_prompt", "by_asset", "by_designInspiration", "by_tag_createdAt"],
      relationships: ["Support list-by-tag flows and tag usage updates."],
      source: "convex/schema.ts, convex/prompts.ts, convex/assets.ts, convex/designInspirations.ts",
    },
    {
      name: "canvasPositions",
      group: "operations",
      purpose: "Stores user-specific coordinates for canvas mode.",
      ownership: "Private per ownerUserId.",
      keyFields: ["assetId", "ownerUserId", "x", "y", "zIndex", "updatedAt"],
      indexes: ["by_owner_asset", "by_owner"],
      relationships: ["References assets._id and drives the canvas view only."],
      source: "convex/schema.ts, convex/canvasPositions.ts",
    },
    {
      name: "semanticDocuments",
      group: "search",
      purpose: "Search index rows generated from prompts, assets, and design inspirations.",
      ownership: "Owner/private and public scopes are both encoded on each row.",
      keyFields: [
        "ownerUserId",
        "sourceType",
        "sourceId",
        "assetId",
        "promptId",
        "designInspirationId",
        "pillar",
        "isPublic",
        "searchText",
        "contentHash",
        "embeddingModel",
        "embeddingDimensions",
        "embedding",
        "scopeKey",
        "scopePillarKey",
        "publicScopeKey",
        "publicScopePillarKey",
      ],
      indexes: ["by_source", "by_owner_source", "search_text", "by_embedding"],
      relationships: ["Mirrors content rows and powers semanticSearch.searchAssets / findSimilarAssets."],
      source: "convex/schema.ts, convex/semanticIndex.ts, convex/semanticSearch.ts",
    },
    {
      name: "semantic_index_failures",
      group: "search",
      purpose: "Tracks semantic indexing failures for later retry or audit.",
      ownership: "Operational state with optional owner linkage.",
      keyFields: ["ownerUserId", "sourceType", "sourceId", "status", "attemptCount", "lastErrorMessage"],
      indexes: ["by_source", "by_status_lastErrorAt", "by_owner_status_lastErrorAt"],
      relationships: ["Operational companion to semanticDocuments."],
      source: "convex/schema.ts",
    },
    {
      name: "ingest_failures",
      group: "operations",
      purpose: "Persists failed ingest attempts and resolution state.",
      ownership: "Operational state with optional owner linkage.",
      keyFields: ["source", "ownerUserId", "ingestKey", "status", "attemptCount", "payload", "lastErrorMessage"],
      indexes: ["by_status_lastErrorAt", "by_owner_status_lastErrorAt", "by_owner_ingestKey"],
      relationships: ["Written by /api/ingest failure handling and cleared after successful replay."],
      source: "convex/schema.ts, app/api/ingest/route.ts, convex/ingest_failures.ts",
    },
    {
      name: "runs / run_events / run_artifacts",
      group: "operations",
      purpose: "Observability layer for AI workspace, Telegram simulation, and agent execution.",
      ownership: "Per userId, with event and artifact children under a run.",
      keyFields: [
        "runs.userId",
        "runs.intent",
        "runs.status",
        "runs.source",
        "run_events.type",
        "run_events.seq",
        "run_artifacts.kind",
      ],
      indexes: ["runs.by_user_createdAt", "runs.by_status_createdAt", "run_events.by_run_seq", "run_artifacts.by_run_createdAt"],
      relationships: ["Used by the AI workspace panel and dev Telegram simulator rather than core gallery rendering."],
      source: "convex/schema.ts, agent-docs/BACKEND_CONVEX_SETUP.md",
    },
  ] satisfies ReviewTable[],
  pillars: [
    {
      pillar: "creators",
      accent: "var(--pillar-creators)",
      summary: "Portrait, influencer, fashion, and style-prompt workflows.",
      primaryRecords: ["prompts", "assets", "tags", "folders", "semanticDocuments"],
      promptProfileFields: ["subjectType", "framing", "cameraAngle", "lighting", "mood"],
      metadataFocus: ["promptType", "modelName", "modelProvider", "tag category metadata"],
      note: "Today this pillar has rich prompt structure but no dedicated first-class reference entity beyond prompts/assets/tags.",
    },
    {
      pillar: "designs",
      accent: "var(--pillar-designs)",
      summary: "Website, dashboard, mobile, component, and design system references.",
      primaryRecords: ["prompts", "assets", "designInspirations", "tags", "folders", "semanticDocuments"],
      promptProfileFields: ["targetType", "style", "platform", "workflowType"],
      metadataFocus: ["designInspirationType", "platform", "workflowType", "sourceDomain"],
      note: "This is the only pillar with a dedicated designInspirations table, so it currently has the richest reference model.",
    },
    {
      pillar: "dump",
      accent: "var(--pillar-dump)",
      summary: "Catch-all storage when material is useful but not yet normalized.",
      primaryRecords: ["prompts", "assets", "tags", "folders", "semanticDocuments", "ingest_failures"],
      promptProfileFields: ["note"],
      metadataFocus: ["ingestSource", "assetRole", "workflowType", "typedTags"],
      note: "Dump is intentionally permissive, which makes it useful for intake but also the easiest place for schema drift to accumulate.",
    },
  ] satisfies ReviewPillar[],
  flows: [
    {
      title: "Telegram and agent ingest",
      summary: "The agent-first path for saving content from Telegram/OpenClaw into Convex.",
      steps: [
        {
          label: "Telegram message arrives in OpenClaw",
          detail: "Michael sends media, prompts, or links to the OpenClaw workflow.",
          source: "AGENTS.md, agent-docs/PROGRESS.md",
        },
        {
          label: "laniameda-gallery-ingest skill builds the payload",
          detail: "The skill script normalizes files, tags, ingest keys, and operation mode (create/update/delete).",
          source: "skills/laniameda-gallery-ingest/SKILL.md, skills/laniameda-gallery-ingest/scripts/ingest.ts",
        },
        {
          label: "Convex ingest action writes canonical rows",
          detail: "ingestFromApi or ingestFromAgentPayload creates prompts, assets, and optionally design inspirations.",
          source: "convex/ingest.ts, convex/agent_ingest.ts",
        },
        {
          label: "Async notifications and reindex jobs fire",
          detail: "The write path schedules notifications plus semantic reindex work instead of blocking on downstream tasks.",
          source: "convex/prompts.ts, convex/assets.ts, convex/designInspirations.ts",
        },
      ],
    },
    {
      title: "Browser upload and management",
      summary: "The route-wrapped path used when the gallery itself writes data.",
      steps: [
        {
          label: "Telegram session cookie authenticates the browser",
          detail: "The session is created in /api/auth/telegram and stored in a signed cookie.",
          source: "app/api/auth/telegram/route.ts, lib/telegram-auth.ts",
        },
        {
          label: "/api/ingest derives ownerUserId from the session",
          detail: "The Next.js route accepts JSON or multipart payloads, sanitizes failure payloads, then calls the Convex action.",
          source: "app/api/ingest/route.ts",
        },
        {
          label: "Update and delete routes forward the same contract",
          detail: "The update and delete endpoints inject ownerUserId from the session and forward to Convex actions.",
          source: "app/api/ingest/update/route.ts, app/api/ingest/delete/route.ts",
        },
        {
          label: "Admin curation toggles publication",
          detail: "Public exposure of assets is handled by a dedicated admin route and a server secret.",
          source: "app/api/admin/assets/[assetId]/curation/route.ts",
        },
      ],
    },
    {
      title: "Retrieval and search",
      summary: "How saved data becomes visible in the dashboard and semantic search.",
      steps: [
        {
          label: "Direct Convex queries feed the dashboard",
          detail: "The browser calls assets, folders, tags, canvas positions, and user functions through convex/react hooks.",
          source: "components/gallery/dashboard.tsx, lib/use-current-user.ts, components/gallery/canvas-mode.tsx",
        },
        {
          label: "Public gallery reads filtered isPublic rows",
          detail: "Public-facing asset reads use listPublicGalleryAssets and curation flags.",
          source: "convex/assets.ts, components/gallery/dashboard.tsx",
        },
        {
          label: "Semantic search hits vector rows, then hydrates assets",
          detail: "The action embeds the query, vector-searches semanticDocuments, and rehydrates gallery assets from ids.",
          source: "convex/semanticSearch.ts, convex/galleryAssetResults.ts",
        },
      ],
    },
  ] satisfies ReviewFlow[],
  skillSurface: [
    {
      name: "skills/laniameda-gallery-ingest/SKILL.md",
      role: "Declares the canonical ingest contract, supported operations, and repo files that must be read first.",
      source: "skills/laniameda-gallery-ingest/SKILL.md",
    },
    {
      name: "skills/laniameda-gallery-ingest/scripts/ingest.ts",
      role: "Turns agent input into create/update/delete payloads and enforces env-driven owner scoping.",
      source: "skills/laniameda-gallery-ingest/scripts/ingest.ts",
    },
    {
      name: "skills/laniameda-gallery-ingest/references/schema-contract.md",
      role: "Quick ingest-focused map of the core tables, validators, and routes.",
      source: "skills/laniameda-gallery-ingest/references/schema-contract.md",
    },
    {
      name: "skills/laniameda-gallery-ingest/references/ingest-examples.md",
      role: "Copy-ready examples for the skill caller surface.",
      source: "skills/laniameda-gallery-ingest/references/ingest-examples.md",
    },
    {
      name: "skills/laniameda-gallery-query/SKILL.md",
      role: "Declares the canonical read/query surface for asset retrieval, semantic search, and designs-pillar browsing.",
      source: "skills/laniameda-gallery-query/SKILL.md",
    },
    {
      name: "agent-docs/AGENT_INGEST_SKILL_CONTEXT.md",
      role: "Implementation-facing explanation of the ingest contract, failure cache, and health checks.",
      source: "agent-docs/AGENT_INGEST_SKILL_CONTEXT.md",
    },
  ] satisfies ReviewSkillArtifact[],
  authLayers: [
    {
      title: "Telegram browser session",
      status: "solid",
      detail:
        "The login widget payload is validated, freshness checked, and stored in a signed cookie before any Next.js route trusts it.",
      source: "app/api/auth/telegram/route.ts, lib/telegram-auth.ts",
    },
    {
      title: "Next.js server wrappers",
      status: "mixed",
      detail:
        "The ingest and admin curation routes correctly derive the acting user from the session, but only the routes benefit from that protection.",
      source: "app/api/ingest/route.ts, app/api/ingest/update/route.ts, app/api/ingest/delete/route.ts, app/api/admin/assets/[assetId]/curation/route.ts",
    },
    {
      title: "Convex function boundary",
      status: "gap",
      detail:
        "Most public Convex queries and mutations trust caller-supplied ownerUserId values instead of a Convex identity. Because the dashboard uses convex/react directly from the browser, this is the main hardening gap.",
      source: "components/gallery/dashboard.tsx, lib/use-current-user.ts, convex/assets.ts, convex/prompts.ts, convex/designInspirations.ts, convex/folders.ts, convex/canvasPositions.ts, convex/users.ts",
    },
  ] satisfies ReviewAuthLayer[],
  findings: [
    {
      severity: "critical",
      title: "Public Convex functions are using ownerUserId as authentication",
      summary:
        "Sensitive Convex queries and mutations authorize off caller-supplied ownerUserId strings instead of an authenticated actor identity.",
      impact:
        "Because the browser calls these functions directly through convex/react, a malicious client can likely read or mutate another user's data by supplying a different ownerUserId and known ids.",
      evidence: [
        "components/gallery/dashboard.tsx calls api.assets.*, api.folders.*, api.canvasPositions.* directly from the browser",
        "lib/use-current-user.ts calls api.users.resolveByTelegramId and api.users.resolveOrCreateByTelegram directly from the browser",
        "convex/assets.ts, convex/prompts.ts, convex/designInspirations.ts, convex/folders.ts, and convex/canvasPositions.ts all trust ownerUserId args",
      ],
      recommendation:
        "Short-term: move sensitive Convex functions to internal/server-only and expose session-authenticated Next.js routes. Long-term: add Convex-aware auth for Telegram sessions, derive the actor in ctx.auth, and remove ownerUserId from public function args.",
    },
    {
      severity: "critical",
      title: "Single-record getters return private documents when ownerUserId is omitted",
      summary:
        "The core getAsset, getPrompt, and getDesignInspiration queries only perform ownership checks when ownerUserId is passed.",
      impact:
        "Any client that knows a record id can fetch private content directly by omitting ownerUserId, which creates a very high-confidence data leak path.",
      evidence: [
        "convex/assets.ts:getAsset returns the asset unless args.ownerUserId is present and fails access",
        "convex/prompts.ts:getPrompt has the same pattern",
        "convex/designInspirations.ts:getDesignInspiration has the same pattern",
      ],
      recommendation:
        "Split these into explicit public and private variants. Private variants should require an authenticated actor; public variants should only return curated/public-safe fields.",
    },
    {
      severity: "critical",
      title: "User identity helpers are publicly callable without ownership checks",
      summary:
        "The users module exposes lookup and linking operations without deriving the acting user from auth.",
      impact:
        "This creates user-enumeration risk and potentially lets callers mutate account linkage state if they can obtain a user id.",
      evidence: [
        "convex/users.ts:resolveByTelegramId and resolveByWorkosUserId return full user rows without auth",
        "convex/users.ts:getUser returns a row by id without auth",
        "convex/users.ts:linkTelegram and linkWorkos mutate user rows without actor verification",
      ],
      recommendation:
        "Make these functions internal or protect them with authenticated server routes. Only allow self-service linkage when the actor identity is proven on the server side.",
    },
    {
      severity: "high",
      title: "Ingest failure records are listable without an auth or admin gate",
      summary:
        "The listIngestFailures query is public and returns failure payloads plus error metadata.",
      impact:
        "Failure rows can expose ingest metadata, urls, prompt text, and operational detail to any caller who can reach the public Convex API.",
      evidence: [
        "convex/ingest_failures.ts:listIngestFailures has no auth check",
        "agent-docs/AGENT_INGEST_SKILL_CONTEXT.md documents calling ingest_failures:listIngestFailures directly",
      ],
      recommendation:
        "Convert the query to internal/admin-only access and expose diagnostics through a protected route or protected internal tooling.",
    },
    {
      severity: "high",
      title: "URL-based ingest can fetch arbitrary remote targets",
      summary:
        "The ingest action fetches whatever url the caller sends and stores the response if it succeeds.",
      impact:
        "This is an SSRF-shaped surface. Even with authenticated callers, it allows the backend runtime to probe remote resources that should probably be denied.",
      evidence: [
        "convex/ingest.ts calls fetch(args.url) directly when url ingest is used",
        "The browser ingest route accepts url input and forwards it to Convex",
      ],
      recommendation:
        "Add url validation plus a denylist for private, loopback, and metadata-service ranges. If possible, add an allowlist for supported public hosts or fetch via a hardened media proxy.",
    },
    {
      severity: "medium",
      title: "Rate limiting is missing on expensive or sensitive entry points",
      summary:
        "Login, ingest, semantic search, and admin-like curation flows are currently unthrottled.",
      impact:
        "This increases abuse risk, error amplification, and unnecessary spend on embeddings, storage, and remote fetches.",
      evidence: [
        "No limiter is applied in app/api/auth/telegram/route.ts or app/api/ingest/*.ts",
        "semanticSearch.searchAssets performs live embedding calls without a caller budget guard",
      ],
      recommendation:
        "Add per-user and per-ip rate limits to routes, and add action-level quotas for semantic search and ingest-heavy flows.",
    },
    {
      severity: "medium",
      title: "ownerUserId is optional in several core tables even though ownership is assumed everywhere",
      summary:
        "The schema allows orphaned content rows for prompts, assets, design inspirations, folders, and failure rows.",
      impact:
        "That optionality makes auth rules harder to reason about and increases the chance of unexpected unowned documents appearing over time.",
      evidence: [
        "convex/schema.ts marks ownerUserId as optional on folders, prompts, assets, designInspirations, ingest_failures, and semantic_index_failures",
        "Create/update code paths almost always require ownerUserId and treat it as mandatory business logic",
      ],
      recommendation:
        "Tighten the schema where possible, migrate legacy rows, and make optional ownership the exception rather than the default.",
    },
    {
      severity: "medium",
      title: "Tag upserts currently read the full tag set on every metadata-aware write",
      summary:
        "The getOrCreateTags* flows build in-memory maps from all tags to resolve canonical matches.",
      impact:
        "This is fine early on but will become a write-path performance and memory issue as the tag catalog grows.",
      evidence: [
        "convex/tags.ts:getOrCreateTags, getOrCreateTagWithCategory, and getOrCreateTagsWithMetadata all collect the full tag set",
      ],
      recommendation:
        "Introduce a dedicated canonical key field/index or a secondary alias table so lookups stay bounded.",
    },
  ] satisfies ReviewFinding[],
  tracks: [
    {
      phase: "Now",
      items: [
        "Lock down the Convex boundary: stop trusting client-supplied ownerUserId on public functions.",
        "Protect or internalize users.ts and ingest_failures:listIngestFailures.",
        "Patch the private getter leak path for getAsset/getPrompt/getDesignInspiration immediately.",
      ],
    },
    {
      phase: "Next",
      items: [
        "Introduce URL validation and rate limiting around ingest and semantic search.",
        "Audit every direct convex/react call and decide which ones remain public versus move behind session-backed routes.",
        "Tighten ownerUserId optionality in the schema once the access model is settled.",
      ],
    },
    {
      phase: "Later",
      items: [
        "Decide whether designInspirations should evolve into a cross-pillar concepts/reference model.",
        "Optimize tag canonicalization so it no longer scans the full tag corpus on each write.",
        "Generate this review page from machine-readable schema metadata to reduce documentation drift.",
      ],
    },
  ] satisfies ReviewTrack[],
  questions: [
    {
      title: "Should Convex become the primary auth boundary, or should sensitive writes move behind Next.js routes?",
      detail:
        "Right now the system mixes both, which is the main reason the access model is hard to trust.",
    },
    {
      title: "Do creators need a first-class reference entity like designs already has?",
      detail:
        "If the answer is yes, a generalized concepts table may be better than continuing to grow promptProfile and tags asymmetrically.",
    },
    {
      title: "Do we want dump to stay permissive, or should intake always normalize into a stronger concept model before save?",
      detail:
        "The current dump pillar is useful operationally, but it will also accumulate the most schema entropy unless there is a cleanup rule.",
    },
  ] satisfies ReviewQuestion[],
  sources: [
    {
      path: "agent-docs/PROGRESS.md",
      purpose: "Shipped features and the current backend scope.",
    },
    {
      path: "agent-docs/OBSERVATIONS.md",
      purpose: "Known runtime quirks and workflow rules for the repo.",
    },
    {
      path: "agent-docs/BACKEND_CONVEX_SETUP.md",
      purpose: "Existing backend summary and run lifecycle notes.",
    },
    {
      path: "agent-docs/AGENT_INGEST_SKILL_CONTEXT.md",
      purpose: "Ingest contract explanation and failure handling notes.",
    },
    {
      path: "convex/schema.ts",
      purpose: "Source of truth for the data model and indexes.",
    },
    {
      path: "convex/validators.ts",
      purpose: "Source of truth for pillar-specific and ingest metadata validators.",
    },
    {
      path: "convex/ingest.ts",
      purpose: "Canonical external ingest, update, and delete actions.",
    },
    {
      path: "convex/agent_ingest.ts",
      purpose: "Agent-run ingest path from the Telegram/OpenClaw workflow.",
    },
    {
      path: "app/api/ingest/route.ts",
      purpose: "Session-backed route wrapper for browser ingest.",
    },
    {
      path: "skills/laniameda-gallery-ingest/SKILL.md",
      purpose: "Canonical agent ingest skill contract that must stay aligned with the schema.",
    },
  ] satisfies ReviewSourceDoc[],
} as const;
