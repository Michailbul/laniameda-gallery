import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tags: defineTable({
    name: v.string(),
    normalized: v.string(),
    usageCount: v.number(),
  }).index("by_normalized", ["normalized"]),
  folders: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
  }).index("by_name", ["name"]),
  prompts: defineTable({
    ownerUserId: v.optional(v.string()),
    text: v.string(),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_folder_createdAt", ["folderId", "createdAt"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"])
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
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
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
    .index("by_createdAt", ["createdAt"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
  assetTags: defineTable({
    assetId: v.id("assets"),
    tagId: v.id("tags"),
    createdAt: v.number(),
  })
    .index("by_asset", ["assetId"])
    .index("by_tag_createdAt", ["tagId", "createdAt"]),
  runs: defineTable({
    userId: v.string(),
    runtime: v.optional(v.union(v.literal("ai_sdk"), v.literal("agent_worker"))),
    provider: v.optional(v.union(v.literal("gateway"), v.literal("provider_direct"))),
    model: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("prompt_package"), v.literal("image_generate"))),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("waiting_input"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
    intent: v.union(
      v.literal("transfer_style"),
      v.literal("transfer_pose"),
      v.literal("replace_character"),
      v.literal("ingest"),
      v.literal("execute"),
    ),
    source: v.union(
      v.literal("dashboard"),
      v.literal("telegram"),
      v.literal("dev_telegram"),
      v.literal("api"),
    ),
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
    createdAt: v.number(),
    updatedAt: v.number(),
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
