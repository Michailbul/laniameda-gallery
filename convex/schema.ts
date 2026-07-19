import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  agentTokenScopeValidator,
  assetRoleValidator,
  cinemaMetadataValidator,
  designCaptureKindValidator,
  designInspirationStatusValidator,
  designInspirationTypeValidator,
  designPlatformValidator,
  designSaveIntentValidator,
  designSaveTemplateDefaultsValidator,
  generationTypeValidator,
  ingestSourceValidator,
  lineageRoleValidator,
  modelProviderValidator,
  optionalPillarValidator,
  optionalProjectSectionValidator,
  promptProfileValidator,
  promptSectionsValidator,
  promptTypeValidator,
  semanticFailureStatusValidator,
  semanticModalityValidator,
  semanticSourceTypeValidator,
  tagCategoryValidator,
  tagSourceValidator,
  workflowTypeValidator,
} from "./validators";

export default defineSchema({
  users: defineTable({
    telegramId: v.optional(v.string()),
    workosUserId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    ownerUserId: v.string(),
    onboardingCompletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_telegramId", ["telegramId"])
    .index("by_workosUserId", ["workosUserId"])
    .index("by_email", ["email"])
    .index("by_ownerUserId", ["ownerUserId"]),
  agentTokens: defineTable({
    ownerUserId: v.string(),
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    label: v.string(),
    scopes: v.array(agentTokenScopeValidator),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_owner_revokedAt_createdAt", ["ownerUserId", "revokedAt", "createdAt"]),
  tags: defineTable({
    name: v.string(),
    normalized: v.string(),
    usageCount: v.number(),
    category: tagCategoryValidator,
    pillar: optionalPillarValidator,
    source: tagSourceValidator,
    aliases: v.optional(v.array(v.string())),
  })
    .index("by_normalized", ["normalized"])
    .index("by_category_normalized", ["category", "normalized"])
    .index("by_pillar_category_normalized", ["pillar", "category", "normalized"]),
  userTags: defineTable({
    ownerUserId: v.string(),
    tagId: v.id("tags"),
    label: v.string(),
    normalizedLabel: v.string(),
    description: v.optional(v.string()),
    category: tagCategoryValidator,
    pillar: optionalPillarValidator,
    source: tagSourceValidator,
    color: v.optional(v.string()),
    sortOrder: v.number(),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_normalizedLabel", ["ownerUserId", "normalizedLabel"])
    .index("by_owner_tagId", ["ownerUserId", "tagId"])
    .index("by_owner_sortOrder", ["ownerUserId", "sortOrder"])
    .index("by_owner_archivedAt_sortOrder", ["ownerUserId", "archivedAt", "sortOrder"]),
  folders: defineTable({
    ownerUserId: v.optional(v.string()),
    name: v.string(),
    normalizedName: v.optional(v.string()),
    description: v.optional(v.string()),
    // Collection flavor. Undefined = standard collection. "storybook" =
    // a narrative set of images; its story text lives in `description`.
    // "project" = a review workspace that GROUPS other collections (its member
    // collections live in the projectCollections join table); its brief lives
    // in `description`.
    kind: v.optional(
      v.union(
        v.literal("storybook"),
        v.literal("project"),
        // A project-scoped direction (beat / stack / pool) created from the
        // workspace — hidden from the sidebar collections list.
        v.literal("direction"),
      ),
    ),
    // Unguessable token that makes a project's direction board publicly
    // viewable at /b/<token>. Unset = sharing off.
    shareToken: v.optional(v.string()),
    // Parent collection for nesting (e.g. "Dear Annette" > "Characters").
    // Only plain collections nest, and only one level deep: a folder with a
    // parent can't be a parent itself. Undefined = root-level.
    parentFolderId: v.optional(v.id("folders")),
    // "My Taste" public showcase flag. When true, a plain collection or a
    // storybook is surfaced (as a whole set) on the public showcase home and
    // becomes browsable by anonymous visitors. Projects are NEVER showcased —
    // they stay private and are shared only via shareToken. Undefined = off.
    // Sub-collections are never showcased directly; they ride along as
    // chapters of their showcased parent.
    showcased: v.optional(v.boolean()),
    // Featured on the public home: showcased sets with this flag get the
    // large hero treatment above the regular stacks. Implies showcased.
    showcaseFeatured: v.optional(v.boolean()),
    // Manual ordering of showcased items on the public home (lower = earlier).
    showcaseOrder: v.optional(v.number()),
    // THE taste collection: at most one plain collection per owner carries
    // this. When set, the public showcase home's inspiration grid shows
    // exactly this collection's members (whole set, like showcased folders)
    // instead of auto-pulling individually-public assets.
    tasteCollection: v.optional(v.boolean()),
    // MASTER option: the asset used as this collection's thumbnail when it is
    // browsed as a "direction" (a set of similar options). Falls back to the
    // first asset when unset or dangling.
    coverAssetId: v.optional(v.id("assets")),
    // Pinned in the project workspace (beat/stack cards float first).
    pinnedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_name", ["name"])
    .index("by_owner_normalizedName", ["ownerUserId", "normalizedName"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_shareToken", ["shareToken"])
    .index("by_showcased", ["showcased"])
    .index("by_tasteCollection", ["tasteCollection"])
    .index("by_parent", ["parentFolderId"]),

  // Which collections belong to a project (folder kind:"project"). A project
  // aggregates the assets of all its member collections for review. Many-to-
  // many so a collection (e.g. a recurring character set) can sit in several
  // projects. Mirrors the assetFolders join pattern.
  projectCollections: defineTable({
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    folderId: v.id("folders"),
    // Which layer/tab of the project this collection is filed under
    // (characters | locations | beats). Undefined = unsorted.
    section: optionalProjectSectionValidator,
    // For beat-layer rows only: which character / location directions this
    // beat uses (member collections of the same project); the beat
    // collection's own assets are the resulting media (videos/stills).
    // The single-id fields are the legacy shape — reads merge them into the
    // arrays; writes go to the arrays only.
    beatCharacterFolderId: v.optional(v.id("folders")),
    beatLocationFolderId: v.optional(v.id("folders")),
    beatCharacterFolderIds: v.optional(v.array(v.id("folders"))),
    beatLocationFolderIds: v.optional(v.array(v.id("folders"))),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_folder", ["projectId", "folderId"])
    .index("by_owner_project", ["ownerUserId", "projectId"])
    .index("by_folder", ["folderId"]),
  // Curated filter pills on the main gallery menu. The owner manages these
  // from the filter bar's admin panel — the raw tag cloud never surfaces
  // directly. An entry maps to either a set of tag names ("tag" kind, matched
  // canonically against the tags table at read time so duplicate tag docs
  // collapse) or a collection ("collection" kind: clicking filters the grid
  // to that folder's members).
  menuFilters: defineTable({
    ownerUserId: v.string(),
    label: v.string(),
    kind: v.union(v.literal("tag"), v.literal("collection")),
    // "tag" kind: names resolved via canonicalTagKey against tags.name.
    tagNames: v.optional(v.array(v.string())),
    // "collection" kind: the folder whose membership this pill filters to.
    folderId: v.optional(v.id("folders")),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner_sortOrder", ["ownerUserId", "sortOrder"]),
  // Authless reactions from shared-board viewers (beta: the share token is
  // the only capability; no viewer accounts). viewerKey is a random client id
  // persisted in the viewer's localStorage so likes toggle per browser;
  // viewerName is whatever they typed ("Lukas"), shown to the owner.
  boardReactions: defineTable({
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    // Exactly one of assetId / folderId is set: a like on one asset, or on a
    // whole direction (a beat card on the shared board).
    assetId: v.optional(v.id("assets")),
    folderId: v.optional(v.id("folders")),
    viewerKey: v.string(),
    viewerName: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_asset", ["projectId", "assetId"])
    .index("by_project_folder", ["projectId", "folderId"])
    .index("by_project_viewer_asset", ["projectId", "viewerKey", "assetId"])
    .index("by_project_viewer_folder", ["projectId", "viewerKey", "folderId"])
    .index("by_project_viewer", ["projectId", "viewerKey"]),
  userPillars: defineTable({
    ownerUserId: v.string(),
    key: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    sortOrder: v.number(),
    isDefault: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_key", ["ownerUserId", "key"])
    .index("by_owner_sortOrder", ["ownerUserId", "sortOrder"])
    .index("by_owner_archivedAt_sortOrder", ["ownerUserId", "archivedAt", "sortOrder"]),
  prompts: defineTable({
    ownerUserId: v.optional(v.string()),
    text: v.string(),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    pillar: optionalPillarValidator,
    promptType: promptTypeValidator,
    domain: v.optional(v.string()),
    modelName: v.optional(v.string()),
    modelProvider: modelProviderValidator,
    workflowType: workflowTypeValidator,
    promptSections: promptSectionsValidator,
    promptProfile: promptProfileValidator,
    workflowId: v.optional(v.id("workflows")),
    workflowStepOrder: v.optional(v.number()),
    workflowStepLabel: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_folder_createdAt", ["folderId", "createdAt"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"])
    .index("by_owner_pillar_createdAt", ["ownerUserId", "pillar", "createdAt"])
    .index("by_owner_pillar_promptType_createdAt", ["ownerUserId", "pillar", "promptType", "createdAt"])
    .index("by_owner_modelName_createdAt", ["ownerUserId", "modelName", "createdAt"])
    .index("by_workflow_stepOrder", ["workflowId", "workflowStepOrder"])
    .index("by_createdAt", ["createdAt"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .searchIndex("search_text", { searchField: "text" }),
  promptTags: defineTable({
    promptId: v.id("prompts"),
    tagId: v.id("tags"),
    createdAt: v.number(),
  })
    .index("by_prompt", ["promptId"])
    .index("by_tag_createdAt", ["tagId", "createdAt"]),
  assets: defineTable({
    ownerUserId: v.optional(v.string()),
    // User-given handle, referenced as @name when composing beats.
    name: v.optional(v.string()),
    // Manual sort weight (higher floats first). Set via move-to-top/bottom
    // in the project workspace; unset = neutral (0).
    orderPriority: v.optional(v.number()),
    // Pinned in the project workspace — floats above everything, with a pin
    // marker. Timestamp so the latest pin leads. Unset = not pinned.
    pinnedAt: v.optional(v.number()),
    kind: v.union(v.literal("image"), v.literal("video")),
    storageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
    r2Key: v.optional(v.string()),
    r2Bucket: v.optional(v.string()),
    thumbR2Key: v.optional(v.string()),
    thumbR2Bucket: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    description: v.optional(v.string()),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    thumbSize: v.optional(v.number()),
    thumbWidth: v.optional(v.number()),
    thumbHeight: v.optional(v.number()),
    promptId: v.optional(v.id("prompts")),
    designInspirationId: v.optional(v.id("designInspirations")),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    modelName: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
    // Owner's personal "like"/favorite flag. Single-user vault, so a boolean on
    // the asset is sufficient (no per-user likes join table needed).
    isLiked: v.optional(v.boolean()),
    curatedByUserId: v.optional(v.string()),
    curatedAt: v.optional(v.number()),
    pillar: optionalPillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
    assetPackId: v.optional(v.id("assetPacks")),
    packSlotIndex: v.optional(v.number()),
    cinemaMetadata: cinemaMetadataValidator,
    createdAt: v.number(),
  })
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_prompt_createdAt", ["promptId", "createdAt"])
    .index("by_owner_prompt_createdAt", ["ownerUserId", "promptId", "createdAt"])
    .index("by_folder_createdAt", ["folderId", "createdAt"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"])
    .index("by_kind_createdAt", ["kind", "createdAt"])
    .index("by_owner_kind_createdAt", ["ownerUserId", "kind", "createdAt"])
    .index("by_owner_pillar_createdAt", ["ownerUserId", "pillar", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_owner_name", ["ownerUserId", "name"])
    .index("by_owner_isLiked_createdAt", ["ownerUserId", "isLiked", "createdAt"])
    .index("by_isPublic_createdAt", ["isPublic", "createdAt"])
    .index("by_isPublic_kind_createdAt", ["isPublic", "kind", "createdAt"])
    .index("by_isPublic_pillar_createdAt", ["isPublic", "pillar", "createdAt"])
    .index("by_owner_modelName_createdAt", ["ownerUserId", "modelName", "createdAt"])
    .index("by_owner_assetRole_createdAt", ["ownerUserId", "assetRole", "createdAt"])
    .index("by_owner_pillar_assetRole_createdAt", ["ownerUserId", "pillar", "assetRole", "createdAt"])
    .index("by_assetPack_packSlotIndex", ["assetPackId", "packSlotIndex"]),
  assetPacks: defineTable({
    ownerUserId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    pillar: optionalPillarValidator,
    tagIds: v.array(v.id("tags")),
    ingestKey: v.optional(v.string()),
    coverAssetId: v.optional(v.id("assets")),
    modelName: v.optional(v.string()),
    domain: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
    itemCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_owner_pillar_createdAt", ["ownerUserId", "pillar", "createdAt"])
    .index("by_isPublic_createdAt", ["isPublic", "createdAt"]),
  workflows: defineTable({
    ownerUserId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    // Knowledge body used to generate the downloadable agent skill.
    agentInstructions: v.optional(v.string()),
    pillar: optionalPillarValidator,
    tagIds: v.array(v.id("tags")),
    ingestKey: v.optional(v.string()),
    // Optional pinned cover; carousel falls back to all step media.
    coverAssetId: v.optional(v.id("assets")),
    stepCount: v.number(),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_owner_pillar_createdAt", ["ownerUserId", "pillar", "createdAt"])
    .index("by_isPublic_createdAt", ["isPublic", "createdAt"]),
  designInspirations: defineTable({
    ownerUserId: v.optional(v.string()),
    // Originally limited to "designs"; now stores web bookmarks across any pillar.
    pillar: optionalPillarValidator,
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceDomain: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    userNote: v.optional(v.string()),
    captureKind: v.optional(designCaptureKindValidator),
    saveIntent: v.optional(designSaveIntentValidator),
    templateKey: v.optional(v.string()),
    sourceFingerprint: v.optional(v.string()),
    searchText: v.string(),
    inspirationType: designInspirationTypeValidator,
    platform: designPlatformValidator,
    workflowType: workflowTypeValidator,
    status: designInspirationStatusValidator,
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    assetId: v.optional(v.id("assets")),
    promptId: v.optional(v.id("prompts")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_promptId", ["promptId"])
    .index("by_owner_promptId", ["ownerUserId", "promptId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_owner_pillar_createdAt", ["ownerUserId", "pillar", "createdAt"])
    .index("by_owner_inspirationType_createdAt", ["ownerUserId", "inspirationType", "createdAt"])
    .index("by_owner_platform_createdAt", ["ownerUserId", "platform", "createdAt"])
    .index("by_owner_workflowType_createdAt", ["ownerUserId", "workflowType", "createdAt"])
    .index("by_owner_captureKind_createdAt", ["ownerUserId", "captureKind", "createdAt"])
    .index("by_owner_saveIntent_createdAt", ["ownerUserId", "saveIntent", "createdAt"])
    .index("by_owner_sourceFingerprint", ["ownerUserId", "sourceFingerprint"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"])
    .index("by_owner_sourceDomain_createdAt", ["ownerUserId", "sourceDomain", "createdAt"])
    .searchIndex("search_text", { searchField: "searchText" }),
  designSaveTemplates: defineTable({
    ownerUserId: v.string(),
    key: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    defaults: designSaveTemplateDefaultsValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_key", ["ownerUserId", "key"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
  designInspirationTags: defineTable({
    designInspirationId: v.id("designInspirations"),
    tagId: v.id("tags"),
    createdAt: v.number(),
  })
    .index("by_designInspiration", ["designInspirationId"])
    .index("by_tag_createdAt", ["tagId", "createdAt"]),
  assetTags: defineTable({
    assetId: v.id("assets"),
    tagId: v.id("tags"),
    createdAt: v.number(),
  })
    .index("by_asset", ["assetId"])
    .index("by_tag_createdAt", ["tagId", "createdAt"]),
  assetFolders: defineTable({
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderId: v.id("folders"),
    createdAt: v.number(),
  })
    .index("by_asset", ["assetId"])
    .index("by_asset_folder", ["assetId", "folderId"])
    .index("by_folder_createdAt", ["folderId", "createdAt"])
    .index("by_owner_asset", ["ownerUserId", "assetId"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"]),
  generationLineage: defineTable({
    ownerUserId: v.string(),
    targetPromptId: v.optional(v.id("prompts")),
    targetAssetId: v.optional(v.id("assets")),
    sourcePromptId: v.optional(v.id("prompts")),
    sourceAssetId: v.optional(v.id("assets")),
    role: lineageRoleValidator,
    stageOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_targetPrompt", ["targetPromptId"])
    .index("by_targetAsset", ["targetAssetId"])
    .index("by_sourcePrompt", ["sourcePromptId"])
    .index("by_sourceAsset", ["sourceAssetId"]),
  canvasPositions: defineTable({
    assetId: v.id("assets"),
    ownerUserId: v.string(),
    x: v.number(),
    y: v.number(),
    zIndex: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_owner_asset", ["ownerUserId", "assetId"])
    .index("by_owner", ["ownerUserId"]),
  ingest_failures: defineTable({
    source: v.union(v.literal("api")),
    ownerUserId: v.optional(v.string()),
    ingestKey: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("resolved")),
    attemptCount: v.number(),
    payload: v.optional(v.any()),
    lastErrorMessage: v.string(),
    lastErrorName: v.optional(v.string()),
    firstErrorAt: v.number(),
    lastErrorAt: v.number(),
    resolvedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_status_lastErrorAt", ["status", "lastErrorAt"])
    .index("by_owner_status_lastErrorAt", ["ownerUserId", "status", "lastErrorAt"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"]),
  semanticDocuments: defineTable({
    ownerUserId: v.string(),
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
    assetId: v.optional(v.id("assets")),
    promptId: v.optional(v.id("prompts")),
    designInspirationId: v.optional(v.id("designInspirations")),
    pillar: optionalPillarValidator,
    isPublic: v.boolean(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    modality: semanticModalityValidator,
    searchText: v.string(),
    contentHash: v.string(),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    embedding: v.array(v.float64()),
    scopeKey: v.string(),
    scopePillarKey: v.optional(v.string()),
    publicScopeKey: v.optional(v.string()),
    publicScopePillarKey: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_owner_source", ["ownerUserId", "sourceType", "sourceId"])
    .index("by_asset", ["assetId"])
    .index("by_prompt", ["promptId"])
    .index("by_designInspiration", ["designInspirationId"])
    .index("by_sourceType_updatedAt", ["sourceType", "sourceUpdatedAt"])
    .searchIndex("search_text", { searchField: "searchText" })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 3072,
      filterFields: [
        "ownerUserId",
        "sourceType",
        "pillar",
        "isPublic",
        "scopeKey",
        "scopePillarKey",
        "publicScopeKey",
        "publicScopePillarKey",
      ],
    }),
  // Cache of query-text embeddings so repeat searches (especially from the
  // public showcase) never re-hit the Gemini embedding endpoint, whose RPM
  // quota is small enough that live per-search calls 429 under light bursts.
  semanticQueryEmbeddings: defineTable({
    queryHash: v.string(),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
  }).index("by_queryHash", ["queryHash"]),
  semantic_index_failures: defineTable({
    ownerUserId: v.optional(v.string()),
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
    status: semanticFailureStatusValidator,
    attemptCount: v.number(),
    lastErrorMessage: v.string(),
    firstErrorAt: v.number(),
    lastErrorAt: v.number(),
    resolvedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_status_lastErrorAt", ["status", "lastErrorAt"])
    .index("by_owner_status_lastErrorAt", ["ownerUserId", "status", "lastErrorAt"]),
  // NOTE: `runs` table has a rogue RunMusic document (jh70zdeqn3hqgth121wkeg0j5n81vdv9)
  // with a completely different shape. Several fields are v.optional to accommodate it
  // until that document is deleted from the Convex dashboard.
  runs: defineTable({
    userId: v.string(),
    runtime: v.optional(v.union(v.literal("ai_sdk"), v.literal("agent_worker"))),
    provider: v.optional(v.union(v.literal("gateway"), v.literal("provider_direct"))),
    model: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("prompt_package"), v.literal("image_generate"))),
    status: v.optional(v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("waiting_input"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled"),
    )),
    intent: v.optional(v.union(
      v.literal("creator_assist"),
      v.literal("transfer_style"),
      v.literal("transfer_pose"),
      v.literal("replace_character"),
      v.literal("ingest"),
      v.literal("execute"),
      v.literal("creator_assist"),
    )),
    source: v.optional(v.union(
      v.literal("dashboard"),
      v.literal("canvas"),
      v.literal("telegram"),
      v.literal("dev_telegram"),
      v.literal("api"),
      v.literal("canvas"),
    )),
    sourceChatId: v.optional(v.string()),
    sourceThreadId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceUpdateId: v.optional(v.number()),
    input: v.optional(v.any()),
    idempotencyKey: v.optional(v.string()),
    workerId: v.optional(v.string()),
    workerClaimedAt: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    sandboxLabel: v.optional(v.string()),
    canceledAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
        estimatedCostUsd: v.optional(v.number()),
      }),
    ),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user_createdAt", ["userId", "createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_createdAt", ["createdAt"]),
  run_events: defineTable({
    runId: v.id("runs"),
    type: v.union(
      v.literal("stream_text"),
      v.literal("tool_call"),
      v.literal("tool_result"),
      v.literal("approval_request"),
      v.literal("error"),
      v.literal("status_change"),
      v.literal("system"),
    ),
    seq: v.number(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_run_seq", ["runId", "seq"])
    .index("by_run_createdAt", ["runId", "createdAt"]),
  run_artifacts: defineTable({
    runId: v.id("runs"),
    kind: v.union(
      v.literal("prompt_package"),
      v.literal("image"),
      v.literal("text"),
      v.literal("json"),
      v.literal("other"),
    ),
    mimeType: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    textContent: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_run_createdAt", ["runId", "createdAt"]),
});
