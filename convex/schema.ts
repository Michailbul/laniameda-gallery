import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  assetRoleValidator,
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_telegramId", ["telegramId"])
    .index("by_workosUserId", ["workosUserId"])
    .index("by_email", ["email"])
    .index("by_ownerUserId", ["ownerUserId"]),
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
  folders: defineTable({
    ownerUserId: v.optional(v.string()),
    name: v.string(),
    normalizedName: v.optional(v.string()),
    description: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_name", ["name"])
    .index("by_owner_normalizedName", ["ownerUserId", "normalizedName"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
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
    createdAt: v.number(),
  })
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_folder_createdAt", ["folderId", "createdAt"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"])
    .index("by_owner_pillar_createdAt", ["ownerUserId", "pillar", "createdAt"])
    .index("by_owner_pillar_promptType_createdAt", ["ownerUserId", "pillar", "promptType", "createdAt"])
    .index("by_owner_modelName_createdAt", ["ownerUserId", "modelName", "createdAt"])
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
    kind: v.union(v.literal("image"), v.literal("video")),
    storageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
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
    curatedByUserId: v.optional(v.string()),
    curatedAt: v.optional(v.number()),
    pillar: optionalPillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
    assetPackId: v.optional(v.id("assetPacks")),
    packSlotIndex: v.optional(v.number()),
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
  designInspirations: defineTable({
    ownerUserId: v.optional(v.string()),
    pillar: v.literal("designs"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
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
