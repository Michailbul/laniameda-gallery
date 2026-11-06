import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { presetFiltersValidator, storyFields } from "./storyValidators";
import {
  characterCostumeValidator, characterLaneValidator, characterLinkRoleValidator, characterStatusValidator,
} from "./characterValidators";
import { moodboardCodeHistoryEntryValidator, moodboardStatusValidator } from "./moodboardValidators";
import { inboxCardFields, inboxCountFields, inboxDecisionFields, inboxStackFields } from "./inboxValidators";
import { taskEventFields, taskFields } from "./taskValidators";
import { newspaperFields } from "./newspaperValidators";
import {
  inspirationAdaptationFields, inspirationEventFields, inspirationSourceFields, inspirationVersionFields,
} from "./inspirationValidators";
import { mjQueueItemFields } from "./mjQueueValidators";
import { worldStyleRecipeValidator, worldStyleStatusValidator } from "./worldStyleValidators";
import {
  reviewCommentFields, reviewFeedbackFields, reviewFolderFields, reviewItemFields,
  reviewProjectFields, reviewStyleFeedbackFields, reviewVersionFields,
} from "./reviewValidators";
import {
  agentTokenScopeValidator,
  storedAssetRoleValidator,
  cinemaMetadataValidator,
  midjourneyMetadataValidator,
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
  agentDescriptionSourceValidator,
  bookmarkPostFields,
  tagSourceValidator,
  workflowTypeValidator,
  thumbVariantValidator,
} from "./validators";
import { SEMANTIC_VECTOR_DIMENSIONS } from "./semanticStorage";

// A split-storage vector row: the lane's vector plus the scope keys the
// vector filter needs. Everything else about the source lives in its entry.
const semanticVectorFields = {
  scopeKey: v.string(),
  scopePillarKey: v.optional(v.string()),
  publicScopeKey: v.optional(v.string()),
  publicScopePillarKey: v.optional(v.string()),
  embedding: v.array(v.float64()),
};

export default defineSchema({
  // Midjourney prompt queue (convex/mjQueue.ts): agents queue, Michael sends.
  mjQueueItems: defineTable(mjQueueItemFields)
    .index("by_owner_batchKey_order", ["ownerUserId", "batchKey", "order"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_owner_updatedAt", ["ownerUserId", "updatedAt"]),
  // Director review (convex/review.ts, reviewValidators.ts).
  reviewProjects: defineTable(reviewProjectFields)
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerUserId"]),
  reviewFolders: defineTable(reviewFolderFields)
    .index("by_project_section_order", ["projectId", "section", "order"]),
  reviewVersions: defineTable(reviewVersionFields)
    .index("by_project_number", ["projectId", "number"]),
  reviewItems: defineTable(reviewItemFields)
    .index("by_version_order", ["versionId", "order"])
    .index("by_version_asset", ["versionId", "assetId"])
    .index("by_project_asset", ["projectId", "assetId"]),
  reviewFeedback: defineTable(reviewFeedbackFields)
    .index("by_project_asset_reviewer", ["projectId", "assetId", "reviewerEmail"])
    .index("by_project_updatedAt", ["projectId", "updatedAt"]),
  reviewStyleFeedback: defineTable(reviewStyleFeedbackFields)
    .index("by_project_style_reviewer", ["projectId", "styleId", "reviewerEmail"])
    .index("by_project_updatedAt", ["projectId", "updatedAt"]),
  reviewComments: defineTable(reviewCommentFields)
    .index("by_project_asset_createdAt", ["projectId", "assetId", "createdAt"])
    .index("by_project_createdAt", ["projectId", "createdAt"]),
  assetArchive: defineTable({
    ownerUserId: v.string(), assetId: v.id("assets"),
    deleteAt: v.number(),
  }).index("by_asset", ["assetId"])
    .index("by_owner", ["ownerUserId"]),
  // Private agent reference documents, kept out of public repository bundles.
  // These are instructions, not creative media or gallery Skills.
  agentInstructions: defineTable({
    ownerUserId: v.string(), resourcePath: v.string(), content: v.string(),
    version: v.string(), sha256: v.string(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_owner_path", ["ownerUserId", "resourcePath"]),
  // A world's own files: WORLD.md (its CLAUDE.md), LEARNINGS.md and a few
  // docs/<name>.md. Size caps live in lib/world-docs.ts; every write is a
  // worldChanges entry holding the before and after text.
  worldDocs: defineTable({
    ownerUserId: v.string(), worldFolderId: v.id("folders"), path: v.string(),
    body: v.string(), revision: v.number(), updatedBy: v.string(),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_owner_world_path", ["ownerUserId", "worldFolderId", "path"]),
  // The world journal: every change made through a world write, with the
  // state before and after it (JSON text) so it can be undone.
  worldChanges: defineTable({
    ownerUserId: v.string(), worldFolderId: v.id("folders"),
    op: v.string(), targetType: v.string(), targetId: v.string(), summary: v.string(),
    actor: v.string(), session: v.optional(v.string()),
    before: v.optional(v.string()), after: v.optional(v.string()),
    // Set on an undo entry: the change it reverted.
    revertOf: v.optional(v.id("worldChanges")),
    // Set on a reverted change: the undo entry that reverted it.
    revertedBy: v.optional(v.id("worldChanges")),
    createdAt: v.number(),
  })
    .index("by_owner_world_createdAt", ["ownerUserId", "worldFolderId", "createdAt"])
    .index("by_owner_session_createdAt", ["ownerUserId", "session", "createdAt"])
    .index("by_owner_target_createdAt", ["ownerUserId", "targetId", "createdAt"]),
  // A Midjourney personalization profile (taste, trained by Michael's
  // rankings), used with --profile <code>. Owner-level: one profile can serve
  // several worlds, each with its own role; a world sees only its own uses.
  mjProfiles: defineTable({
    ownerUserId: v.string(), name: v.string(), normalizedName: v.string(),
    code: v.string(), mjProfileId: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("retired")),
    notes: v.optional(v.string()),
    codeHistory: v.array(v.object({ code: v.string(), at: v.number(), note: v.optional(v.string()) })),
    uses: v.array(v.object({
      worldFolderId: v.id("folders"), role: v.string(), styleTag: v.optional(v.string()),
    })),
    revision: v.number(), createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_owner_normalizedName", ["ownerUserId", "normalizedName"])
    .index("by_owner_code", ["ownerUserId", "code"]),
  // One named style of a world (Ink Noir, Lacquer & Brass, Long Sun): how a
  // frame is made, whatever it shows. Its frames are the members of its
  // shelf (a child collection in the group Styles); the record holds what the
  // shelf cannot: a one-line description, the cover frames, the recipes
  // (moodboards and profiles in stack order, parameters, a prompt template)
  // and what raises or lowers the look. The long recipe text stays in the
  // style lock (a style-lock Story), linked by lockStoryId.
  worldStyles: defineTable({
    ownerUserId: v.string(), worldFolderId: v.id("folders"),
    name: v.string(), slug: v.string(),
    line: v.optional(v.string()),
    // Carousel group inside the universe ("Film", "Art Deco", "3D").
    family: v.optional(v.string()),
    status: worldStyleStatusValidator,
    shelfFolderId: v.optional(v.id("folders")),
    coverAssetIds: v.array(v.id("assets")),
    recipes: v.array(worldStyleRecipeValidator),
    raises: v.array(v.string()),
    lowers: v.array(v.string()),
    lockStoryId: v.optional(v.id("stories")),
    notes: v.optional(v.string()),
    mergedIntoStyleId: v.optional(v.id("worldStyles")),
    sortOrder: v.optional(v.number()),
    revision: v.number(), createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_owner_world_slug", ["ownerUserId", "worldFolderId", "slug"])
    .index("by_owner_shelf", ["ownerUserId", "shelfFolderId"]),
  // Text is a first-class private save; no placeholder media or prompt needed.
  stories: defineTable({
    ownerUserId: v.string(), ...storyFields,
    ingestKey: v.string(), revision: v.number(), searchText: v.string(),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_owner_updatedAt", ["ownerUserId", "updatedAt"])
    .index("by_owner_folder_updatedAt", ["ownerUserId", "folderId", "updatedAt"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["ownerUserId"] }),
  storyRevisions: defineTable({
    ownerUserId: v.string(), storyId: v.id("stories"), ...storyFields,
    revision: v.number(), savedAt: v.number(),
  }).index("by_story_revision", ["storyId", "revision"]),
  // Named people of a world. `code` (DA-CH-001) is the stable ID agents and
  // storybook CAST blocks cite; costumes are -C01, -C02 variants on the row.
  characters: defineTable({
    ownerUserId: v.string(), worldFolderId: v.id("folders"),
    code: v.string(), prefix: v.string(), number: v.number(),
    name: v.string(), alias: v.optional(v.string()), normalizedName: v.string(),
    otherNames: v.array(v.string()), role: v.optional(v.string()),
    lane: v.optional(characterLaneValidator), status: characterStatusValidator,
    sheetAssetId: v.optional(v.id("assets")), faceAssetId: v.optional(v.id("assets")),
    nameTag: v.optional(v.string()), notes: v.optional(v.string()),
    costumes: v.array(characterCostumeValidator), lastCostumeNumber: v.number(),
    // Count of characterAssets rows, kept by every link write and the asset
    // delete cascade so listing the cast never reads every link.
    linkCount: v.number(),
    revision: v.number(), createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_owner_code", ["ownerUserId", "code"])
    .index("by_owner_world_number", ["ownerUserId", "worldFolderId", "number"])
    .index("by_owner_world_normalizedName", ["ownerUserId", "worldFolderId", "normalizedName"])
    .index("by_owner_updatedAt", ["ownerUserId", "updatedAt"]),
  // Per-world code prefix and counter, so a deleted character's number is
  // never handed out again and two worlds never share a prefix.
  characterWorlds: defineTable({
    ownerUserId: v.string(), folderId: v.id("folders"), prefix: v.string(),
    lastNumber: v.number(), createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_owner_folder", ["ownerUserId", "folderId"])
    .index("by_owner_prefix", ["ownerUserId", "prefix"]),
  // Typed asset-to-character link. One row per (character, asset); a sheet or
  // face pointer on the character always has a row here.
  characterAssets: defineTable({
    ownerUserId: v.string(), characterId: v.id("characters"), assetId: v.id("assets"),
    role: characterLinkRoleValidator, costumeCode: v.optional(v.string()),
    note: v.optional(v.string()), createdAt: v.number(),
  })
    .index("by_character_createdAt", ["characterId", "createdAt"])
    .index("by_character_asset", ["characterId", "assetId"])
    .index("by_asset", ["assetId"]),
  // An ordered set of gallery assets that defines one look, mirrored to a
  // Midjourney moodboard (personalization code). Belongs to one plain
  // collection: a world root or one of its children, never a storybook.
  moodboards: defineTable({
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    name: v.string(),
    // Unique per (owner, folder); a retried create returns the same board.
    normalizedName: v.string(),
    // What the board carries and when to use it.
    description: v.optional(v.string()),
    // Lowercase hyphenated style key, e.g. "da-film".
    styleTag: v.optional(v.string()),
    status: moodboardStatusValidator,
    // Short personalization code ("88ji6bg"), kept as a string as given.
    mjCode: v.optional(v.string()),
    // Midjourney's moodboard id; prompts can use --profile m<id>.
    mjMoodboardId: v.optional(v.string()),
    mjUrl: v.optional(v.string()),
    mjSyncedAt: v.optional(v.number()),
    mjSyncedItemCount: v.optional(v.number()),
    mjCodeHistory: v.optional(v.array(moodboardCodeHistoryEntryValidator)),
    // Agent and owner notes: like rates, recipe partners ("+ DARI h2eu2z6").
    notes: v.optional(v.string()),
    coverAssetId: v.optional(v.id("assets")),
    // Kept exact by every item write and the asset delete cascade.
    itemCount: v.number(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_folder_normalizedName", ["ownerUserId", "folderId", "normalizedName"])
    .index("by_owner_updatedAt", ["ownerUserId", "updatedAt"])
    .index("by_owner_mjCode", ["ownerUserId", "mjCode"]),
  // One asset on one board. `position` ascends in display order; an append
  // takes the last position + 1. One row per (board, asset).
  moodboardItems: defineTable({
    ownerUserId: v.string(),
    moodboardId: v.id("moodboards"),
    assetId: v.id("assets"),
    position: v.number(),
    note: v.optional(v.string()),
    addedAt: v.number(),
  })
    .index("by_moodboard_position", ["moodboardId", "position"])
    .index("by_moodboard_asset", ["moodboardId", "assetId"])
    .index("by_asset", ["assetId"]),
  // Notes on one asset, newest last: Michael's comments from the detail panel
  // and agents' replies. Agents read them with the asset and act on them.
  assetComments: defineTable({
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    // Empty when the comment is a voice note only.
    body: v.string(),
    author: v.union(v.literal("owner"), v.literal("agent")),
    // A voice note in Convex file storage (Michael's notes from the Inbox).
    audioStorageId: v.optional(v.id("_storage")),
    audioDurationMs: v.optional(v.number()),
    audioContentType: v.optional(v.string()),
    // Where it was written; absent = the detail panel or an agent.
    // "inspiration" = a note on an inspiration source (/inspiration): inert,
    // it never opens a task (only an explicit Redo does).
    source: v.optional(v.union(v.literal("inbox"), v.literal("inspiration"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_asset_createdAt", ["assetId", "createdAt"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
  // In-place edits: one row per model per take sent on an asset from the
  // detail panel, the Inbox zoom or an agent. Runs on fal or Pika along the
  // model's route (lib/edit-models.ts); the result lands as a new asset in
  // the source's collections with edit_source lineage. See convex/editJobs.ts.
  editJobs: defineTable({
    ownerUserId: v.string(),
    sourceAssetId: v.id("assets"),
    // The source's collections when the edit was sent; the result joins them.
    folderIds: v.array(v.id("folders")),
    worldFolderId: v.optional(v.id("folders")),
    prompt: v.string(),
    model: v.string(),
    modelName: v.string(),
    // The route in use (or the one that landed) and its request at the provider.
    provider: v.string(),
    endpoint: v.string(),
    requestId: v.optional(v.string()),
    statusUrl: v.optional(v.string()),
    responseUrl: v.optional(v.string()),
    attempts: v.array(v.object({
      provider: v.string(),
      endpoint: v.string(),
      requestId: v.optional(v.string()),
      error: v.optional(v.string()),
      outOfCredit: v.optional(v.boolean()),
      at: v.number(),
    })),
    // Bumped by every Retry that sends a new request (a fresh idempotency key).
    retries: v.number(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("error")),
    error: v.optional(v.string()),
    errorKind: v.optional(v.union(
      v.literal("out_of_credit"), v.literal("provider"), v.literal("timeout"), v.literal("ingest"),
    )),
    estimateUsd: v.number(),
    chargedUsd: v.optional(v.number()),
    // True when the provider reported the charge (Pika billing); false = the estimate.
    chargedExact: v.optional(v.boolean()),
    batch: v.string(),
    take: v.number(),
    of: v.number(),
    refAssetIds: v.array(v.id("assets")),
    refNames: v.array(v.string()),
    refsDropped: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    // Before 5 Nov 2026 a landed take became its own asset (resultAssetId).
    // Since then it is a pending take: its media lives here (`takeMedia`) and
    // nowhere in the grid, search or world pages until the owner approves it
    // (it becomes the source's current version, see assetVersions) or
    // discards it (kept here, recoverable). `review` absent = a legacy take.
    resultAssetId: v.optional(v.id("assets")),
    resultUrl: v.optional(v.string()),
    takeMedia: v.optional(v.object({
      r2Key: v.optional(v.string()),
      thumbR2Key: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
      thumbStorageId: v.optional(v.id("_storage")),
      contentType: v.string(),
      contentHash: v.optional(v.string()),
      size: v.optional(v.number()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      thumbSize: v.optional(v.number()),
      thumbWidth: v.optional(v.number()),
      thumbHeight: v.optional(v.number()),
      thumbVariants: v.optional(v.array(thumbVariantValidator)),
      notes: v.optional(v.string()),
    })),
    review: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("discarded"))),
    reviewedAt: v.optional(v.number()),
    createdBy: v.union(v.literal("owner"), v.literal("agent")),
    pollCount: v.number(),
    submittedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source_createdAt", ["sourceAssetId", "createdAt"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_result", ["resultAssetId"]),
  // Every picture an asset has been: its original and each approved in-place
  // edit, append-only. The asset row always shows one of them (matched by
  // media key); restoring a version copies its media back onto the same
  // asset, so its id, links, collections and tags never change.
  assetVersions: defineTable({
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    number: v.number(),
    origin: v.union(v.literal("original"), v.literal("edit")),
    editJobId: v.optional(v.id("editJobs")),
    modelName: v.optional(v.string()),
    prompt: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    thumbR2Key: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
    sourceUrl: v.optional(v.string()),
    contentType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    size: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    thumbSize: v.optional(v.number()),
    thumbWidth: v.optional(v.number()),
    thumbHeight: v.optional(v.number()),
    thumbVariants: v.optional(v.array(thumbVariantValidator)),
    createdAt: v.number(),
  })
    .index("by_asset_number", ["assetId", "number"]),
  // Provider keys and sign-ins set in Settings (fal and Pika API keys, the
  // Magnific connection). `sealed` is AES-GCM ciphertext (convex/providerVault.ts);
  // nothing here is ever returned to a client except `hint` and `account`.
  providerCredentials: defineTable({
    ownerUserId: v.string(),
    provider: v.union(v.literal("fal"), v.literal("pika"), v.literal("magnific")),
    sealed: v.string(),
    // Last four characters of a key, or nothing for a sign-in.
    hint: v.optional(v.string()),
    // Who a sign-in belongs to (Magnific account email or name).
    account: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner_provider", ["ownerUserId", "provider"]),
  // The world Inbox ("Decisions"): stacks of cards agents post for Michael,
  // one decision per card. See convex/inbox.ts.
  inboxStacks: defineTable(inboxStackFields)
    .index("by_owner_status_createdAt", ["ownerUserId", "status", "createdAt"])
    .index("by_world_status_createdAt", ["worldFolderId", "status", "createdAt"])
    .index("by_owner_world_ingestKey", ["ownerUserId", "worldFolderId", "ingestKey"]),
  inboxCards: defineTable(inboxCardFields)
    .index("by_stack_position", ["stackId", "position"])
    .index("by_stack_key", ["stackId", "key"]),
  inboxCounts: defineTable(inboxCountFields)
    .index("by_stack", ["stackId"])
    .index("by_owner_status", ["ownerUserId", "status"]),
  // One perceptual hash (dHash, 16 hex) per image, for Group similar and the
  // duplicates routine. Small rows of their own so grouping never reads asset
  // rows. See convex/assetHashes.ts and convex/perceptualHash.ts.
  assetHashes: defineTable({
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    dHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_asset", ["assetId"])
    .index("by_owner", ["ownerUserId"]),
  // What the auto-tagger (Jev at version 1, gpt-6-luna from version 2)
  // answered about a picture and the tags that added. One row per asset;
  // addedTagIds is exactly what undoClassificationTags takes back.
  // See lib/facet-tags.ts and convex/tagClassify.ts.
  assetClassifications: defineTable({
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    model: v.string(),
    version: v.number(),
    status: v.union(v.literal("done"), v.literal("error"), v.literal("no_image")),
    answers: v.optional(v.record(v.string(), v.object({
      choice: v.optional(v.string()),
      confidence: v.optional(v.number()),
      p: v.optional(v.number()),
    }))),
    addedTagIds: v.array(v.id("tags")),
    error: v.optional(v.string()),
    classifiedAt: v.number(),
  })
    .index("by_asset", ["assetId"])
    .index("by_owner_classifiedAt", ["ownerUserId", "classifiedAt"]),
  // Auto-shelving (convex/shelfClassify.ts, rule lib/shelf-rules.ts): which of
  // its world's Places / World building / Moods shelves a new picture was put
  // on, with the answers behind it, so a bad pick can be taken back.
  assetShelfFilings: defineTable({
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    worldId: v.id("folders"),
    model: v.string(),
    version: v.number(),
    status: v.union(v.literal("done"), v.literal("error")),
    answers: v.optional(v.record(v.string(), v.object({
      choice: v.optional(v.string()),
      confidence: v.optional(v.number()),
      p: v.optional(v.number()),
    }))),
    addedFolderIds: v.array(v.id("folders")),
    error: v.optional(v.string()),
    filedAt: v.number(),
  })
    .index("by_asset", ["assetId"])
    .index("by_owner_filedAt", ["ownerUserId", "filedAt"]),
  inboxDecisions: defineTable(inboxDecisionFields)
    .index("by_stack", ["stackId"])
    .index("by_card", ["cardId"]),
  // The agent task queue ("Tasks"): work Michael or an agent files, an agent
  // claims and completes, Michael reviews. A world task belongs to a root
  // collection; a task without one is studio-wide. See convex/tasks.ts.
  tasks: defineTable(taskFields)
    .index("by_owner_status_createdAt", ["ownerUserId", "status", "createdAt"])
    .index("by_world_status_createdAt", ["worldFolderId", "status", "createdAt"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_owner_updatedAt", ["ownerUserId", "updatedAt"]),
  // A task's timeline: claims, releases, status changes and comments.
  taskEvents: defineTable(taskEventFields)
    .index("by_task_createdAt", ["taskId", "createdAt"]),
  // Inspiration review (convex/inspiration.ts, lib/inspiration-contract.ts):
  // a saved reference, its proposed project adaptations, their versions and
  // Michael's feedback. Raw source media stays where it was saved (assets in
  // INSPIRATION SOURCE, or Stories); a version's outputs live on the version
  // row, never as assets, so drafts cannot reach the grid, search, world
  // pages or reference selection until Michael promotes one.
  inspirationSources: defineTable(inspirationSourceFields)
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_owner_updatedAt", ["ownerUserId", "updatedAt"]),
  inspirationAdaptations: defineTable(inspirationAdaptationFields)
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_source_createdAt", ["sourceId", "createdAt"])
    .index("by_owner_status_updatedAt", ["ownerUserId", "status", "updatedAt"]),
  inspirationVersions: defineTable(inspirationVersionFields)
    .index("by_adaptation_number", ["adaptationId", "number"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"]),
  // Append-only: every note and decision, keyed by the client's event key so
  // a double tap or a retried request applies once.
  inspirationEvents: defineTable(inspirationEventFields)
    .index("by_owner_eventKey", ["ownerUserId", "eventKey"])
    .index("by_source_createdAt", ["sourceId", "createdAt"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
  // The morning newspaper: one edition per owner per Prague date, compiled by
  // the daily cron (or on demand) from the tables above; facts as JSON, the
  // agent's prose beside them. See convex/newspaper.ts.
  newspapers: defineTable(newspaperFields)
    .index("by_owner_date", ["ownerUserId", "date"]),
  galleryPresets: defineTable({
    ownerUserId: v.string(), name: v.string(), normalizedName: v.string(),
    filters: presetFiltersValidator, createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_owner_normalizedName", ["ownerUserId", "normalizedName"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
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
    .index("by_ownerUserId", ["ownerUserId"]),
  agentTokens: defineTable({
    ownerUserId: v.string(),
    tokenHash: v.string(),
    // Durable single-use OAuth code consumption, committed with token minting.
    oauthCodeHash: v.optional(v.string()),
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
    .index("by_oauthCodeHash", ["oauthCodeHash"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
  tags: defineTable({
    name: v.string(),
    normalized: v.string(),
    // canonicalTagKey(name) — the key every lookup actually matches on.
    // `normalized` uses a different (older) normalization, which forced
    // full-table scans; index lookups go through this column instead.
    // Backfill: tags:backfillCanonicalKeys.
    canonicalKey: v.optional(v.string()),
    usageCount: v.number(),
    category: tagCategoryValidator,
    pillar: optionalPillarValidator,
    source: tagSourceValidator,
    aliases: v.optional(v.array(v.string())),
  })
    .index("by_normalized", ["normalized"])
    .index("by_canonicalKey", ["canonicalKey"]),
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
    .index("by_owner_sortOrder", ["ownerUserId", "sortOrder"]),
  folders: defineTable({
    ownerUserId: v.optional(v.string()),
    name: v.string(),
    normalizedName: v.optional(v.string()),
    description: v.optional(v.string()),
    // Collection flavor. Undefined = standard collection. "storybook" = a
    // narrative set of images; its story text lives in `description`.
    kind: v.optional(v.union(v.literal("storybook"))),
    // Parent collection for nesting, one level deep: a root collection may
    // hold sub-collections ("Dear Annete" > "Dari"); a sub-collection holds
    // none. What a piece IS (character / location / scene) is a tag, not a
    // folder.
    parentFolderId: v.optional(v.id("folders")),
    // Public showcase flag. When true, a plain collection or a storybook is
    // surfaced on the public home and becomes browsable
    // by anonymous visitors. Only assets individually marked isPublic are ever
    // exposed — showcasing a set publishes the SET, never its private members.
    // Undefined = off.
    // Sub-collections are never showcased directly; they ride along as
    // chapters of their showcased parent.
    showcased: v.optional(v.boolean()),
    // URL slug for a showcased world: /w/<slug>. Derived from the name when a
    // collection is first showcased; unique per owner. Undefined = address by id.
    slug: v.optional(v.string()),
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
    // The asset used as this collection's thumbnail. Falls back to the first
    // asset when unset or dangling.
    coverAssetId: v.optional(v.id("assets")),
    // Pinned: floats first among its siblings.
    pinnedAt: v.optional(v.number()),
    // Hidden from the gallery: the collection's members drop out of the
    // owner's main (unscoped) gallery grid. Opening the collection still shows
    // everything, and search still finds its pieces. Hiding a root collection
    // hides its sub-collections too. Undefined = shown.
    hiddenFromGallery: v.optional(v.boolean()),
    // Display group of a child collection inside its world ("Styles",
    // "Places", "Cast"), at most 40 characters. Accepted on roots, ignored
    // there. Undefined = ungrouped (listed after the groups, as before).
    group: v.optional(v.string()),
    // Order of a child inside its group, and of the group by its smallest
    // member. Lower first; undefined after any set value.
    sortOrder: v.optional(v.number()),
    // Denormalized count of assetFolders links pointing here. Maintained by
    // recountFolderMembers (self-healing recount after membership writes) —
    // never ±1 bookkeeping. Backfill: folders:recountAllFolderMembers.
    memberCount: v.optional(v.number()),
    // Marks a root collection as a world: a separate story universe whose
    // children (style branches, shelves, storybooks) belong to it alone.
    // Lowercase hyphenated, unique per owner ("dear-annete"). Undefined = not
    // a world (ART, LOVE and other shared shelves).
    worldKey: v.optional(v.string()),
    // A world root that is part of another world's universe: DEAR ANNETE —
    // 3D, — ART DECO and IRON STAGE point at DEAR ANNETE, so one styles page
    // shows every style of the story universe. Membership stays per world.
    universeRootId: v.optional(v.id("folders")),
    // The world's public page (/w/<slug>), set by the owner. allMembers shows
    // every member that is not worldPageHidden instead of only isPublic ones;
    // heroReelAssetId pins the hero video (else the newest member tagged
    // showreel, then a featured video); leadAssetIds open the grid after the
    // featured frames; sides are the switchable worlds on
    // one page ("Live action" = this root, "3D" = a universe sibling).
    worldPage: v.optional(
      v.object({
        allMembers: v.optional(v.boolean()),
        heroReelAssetId: v.optional(v.id("assets")),
        // Frames that open the page right after the featured ones, in order.
        leadAssetIds: v.optional(v.array(v.id("assets"))),
        // Full-screen hero inserts, in order. The first opens the page (the
        // world's hero); the rest cut into the wall every ~18 frames. One
        // frame = full bleed, two = split, three = triptych; the layout is
        // the count, so it can never disagree with the frames. Empty or
        // unset = the old hero (heroReelAssetId, then showreel).
        heroInserts: v.optional(
          v.array(v.object({ assetIds: v.array(v.id("assets")) })),
        ),
        sides: v.optional(
          v.array(
            v.object({
              key: v.string(),
              label: v.string(),
              folderId: v.id("folders"),
            }),
          ),
        ),
      }),
    ),
    // Exact public assets, deduped across links + the legacy primary pointer.
    // Only readable as complete after publicCollectionCountBackfill is done.
    publicMemberCount: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_owner_normalizedName", ["ownerUserId", "normalizedName"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_owner_kind", ["ownerUserId", "kind"])
    .index("by_owner_hiddenFromGallery", ["ownerUserId", "hiddenFromGallery"])
    .index("by_showcased", ["showcased"])
    .index("by_slug", ["slug"])
    .index("by_tasteCollection", ["tasteCollection"])
    .index("by_publicMemberCount", ["publicMemberCount"])
    .index("by_parent", ["parentFolderId"])
    .index("by_owner_worldKey", ["ownerUserId", "worldKey"]),

  // The counted contribution of each public asset. Reconciliation applies
  // set differences in the same transaction as the source mutation, so
  // retries, duplicate links and backfill/live-write overlap cannot drift.
  publicCollectionMemberships: defineTable({
    assetId: v.id("assets"),
    folderIds: v.array(v.id("folders")),
  }).index("by_asset", ["assetId"]),
  publicCollectionCountBackfill: defineTable({
    key: v.literal("v1"),
    cursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
    scanned: v.number(),
  }).index("by_key", ["key"]),

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
  // Owner settings for the public surface. One row per showcase owner; the
  // authless Browse queries read it (convex/publicSurface.ts). Absent row =
  // the curated default, so nothing changes for a vault that never set it.
  publicSurfaceSettings: defineTable({
    ownerUserId: v.string(),
    // What the public Browse view walks: the isPublic slice, or the whole
    // vault. Featured is curated regardless.
    browseScope: v.union(v.literal("published"), v.literal("everything")),
    updatedByUserId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerUserId"]),
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
    skillId: v.optional(v.id("skills")),
    skillStepOrder: v.optional(v.number()),
    skillStepLabel: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_folder_createdAt", ["folderId", "createdAt"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"])
    .index("by_owner_pillar_createdAt", ["ownerUserId", "pillar", "createdAt"])
    .index("by_owner_modelName_createdAt", ["ownerUserId", "modelName", "createdAt"])
    .index("by_skill_stepOrder", ["skillId", "skillStepOrder"])
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
    // Smaller grid renditions of the card thumb (480 and 960 wide, WebP) for
    // the tile srcset; made at ingest and by the thumbnail backfill. Absent
    // on videos without a poster and on images narrower than the widths.
    thumbVariants: v.optional(v.array(thumbVariantValidator)),
    promptId: v.optional(v.id("prompts")),
    designInspirationId: v.optional(v.id("designInspirations")),
    // The saved social post this asset belongs to. A post's own preview has
    // assetRole "bookmark" and renders as a post card; media saved from the
    // post is linked here too and keeps its own role.
    bookmarkId: v.optional(v.id("bookmarks")),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    // SHA-256 of the media bytes, hex. The CALLER-independent identity of a
    // file: `ingestKey` only dedupes when the caller happens to pass the same
    // key, so the same image saved from two URLs (or re-downloaded under a new
    // file name) used to land twice. Set on ingest for every path that has the
    // bytes; backfilled for older rows by
    // assets:backfillContentHashes. Undefined = never hashed.
    contentHash: v.optional(v.string()),
    modelName: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
    // Owner's personal "like"/favorite flag. Single-user vault, so a boolean on
    // the asset is sufficient (no per-user likes join table needed).
    isLiked: v.optional(v.boolean()),
    // Owner's STAR: this one is a standout. Travels with the asset, so it reads
    // the same in a collection, a world, a project section or plain browse —
    // starred pieces lead every grid they appear in and render highlighted.
    // Timestamped so the most recently starred leads; unset = not starred.
    // (Distinct from pinnedAt, which is manual ordering local to the project
    // workspace and carries no note.)
    starredAt: v.optional(v.number()),
    // Left off public world pages (a duplicate take, an artifact, a frame
    // Michael rejected). Data, never hard-coded ids; the vault still shows it.
    worldPageHidden: v.optional(v.boolean()),
    worldPageHiddenReason: v.optional(v.string()),
    // A hero frame's high-resolution renditions (Topaz upscale, JPEG, R2),
    // smallest first: the world page serves them to large and retina screens
    // only, through the hero's srcset. Made when a still becomes a hero
    // (convex/heroRendition.ts, or scripts/upscale-hero.ts). Unset = none.
    heroRendition: v.optional(
      v.object({
        variants: v.array(v.object({ r2Key: v.string(), width: v.number(), height: v.number() })),
        model: v.string(),
        createdAt: v.number(),
      }),
    ),
    // Optional owner note on why this one is starred. Only surfaced while the
    // asset is starred; kept on unstar so an accidental toggle loses nothing.
    starNote: v.optional(v.string()),
    // Owner's SUPER LIKE (styles page, key ⇧1): a stronger like that stays
    // private. Unlike the curator's star it never publishes or features the
    // piece. Super liking also sets isLiked. Unset = not super liked.
    superLikedAt: v.optional(v.number()),
    curatedByUserId: v.optional(v.string()),
    curatedAt: v.optional(v.number()),
    pillar: optionalPillarValidator,
    generationType: generationTypeValidator,
    assetRole: storedAssetRoleValidator,
    ingestSource: ingestSourceValidator,
    assetPackId: v.optional(v.id("assetPacks")),
    packSlotIndex: v.optional(v.number()),
    cinemaMetadata: cinemaMetadataValidator,
    midjourneyMetadata: midjourneyMetadataValidator,
    // Agent-written description: one or two plain sentences on what the piece
    // shows and why it was kept. Separate from `description` (Michael's own
    // caption) so user metadata and agent-derived metadata never mix. Indexed
    // into the text lane of semantic search. `agentDescriptionSource` says who
    // wrote it: "agent" = an agent at save time, "auto" = the enrichment pass.
    agentDescription: v.optional(v.string()),
    agentDescriptionSource: v.optional(agentDescriptionSourceValidator),
    agentDescribedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_ingestKey", ["ingestKey"])
    .index("by_owner_ingestKey", ["ownerUserId", "ingestKey"])
    .index("by_owner_contentHash", ["ownerUserId", "contentHash"])
    .index("by_owner_sourceUrl", ["ownerUserId", "sourceUrl"])
    .index("by_bookmark", ["bookmarkId"])
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
    // "Is this in the gallery?" for local boards: prefix ranges over
    // mj-<job>-<index>.png and other saved file names (worldStyles.findAssets).
    .index("by_owner_fileName", ["ownerUserId", "fileName"])
    .index("by_owner_isLiked_createdAt", ["ownerUserId", "isLiked", "createdAt"])
    // Backs the starred-first prepend: a small set read on its own so a starred
    // asset leads the grid even when its natural page hasn't streamed in yet.
    .index("by_owner_starredAt", ["ownerUserId", "starredAt"])
    .index("by_isPublic_createdAt", ["isPublic", "createdAt"])
    .index("by_isPublic_kind_createdAt", ["isPublic", "kind", "createdAt"])
    .index("by_isPublic_pillar_createdAt", ["isPublic", "pillar", "createdAt"])
    .index("by_owner_modelName_createdAt", ["ownerUserId", "modelName", "createdAt"])
    .index("by_owner_assetRole_createdAt", ["ownerUserId", "assetRole", "createdAt"])
    .index("by_owner_pillar_assetRole_createdAt", ["ownerUserId", "pillar", "assetRole", "createdAt"])
    .index("by_assetPack_packSlotIndex", ["assetPackId", "packSlotIndex"]),
  assetPacks: defineTable({
    ownerUserId: v.optional(v.string()),
    // "stack": alternates Michael collapsed under one cover (Inbox duplicates).
    // Prompt syncing never moves a stack's members. Absent = a prompt pack.
    kind: v.optional(v.literal("stack")),
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
  skills: defineTable({
    ownerUserId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    // Knowledge body used to generate the downloadable agent skill.
    agentInstructions: v.optional(v.string()),
    // The skill as a document: markdown, read top to bottom like a post.
    // `![caption](asset:<id>)` embeds a gallery image inline. Optional — a
    // skill without a body reads as its description, instructions and steps.
    body: v.optional(v.string()),
    pillar: optionalPillarValidator,
    tagIds: v.array(v.id("tags")),
    ingestKey: v.optional(v.string()),
    // Optional pinned cover; carousel falls back to all step media.
    // Agent Skill creation retries resume until finalized. Separate from
    // editable content so replaying a creation never overwrites later edits.
    creationFingerprint: v.optional(v.string()),
    creationComplete: v.optional(v.boolean()),
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
  // Native Skill <-> collection membership. A skill can sit in any
  // number of collections, like an asset through assetFolders. Skills never
  // count toward folders.memberCount, which counts assets.
  skillFolders: defineTable({
    ownerUserId: v.string(),
    skillId: v.id("skills"),
    folderId: v.id("folders"),
    createdAt: v.number(),
  })
    .index("by_skill", ["skillId"])
    .index("by_skill_folder", ["skillId", "folderId"])
    .index("by_folder_createdAt", ["folderId", "createdAt"]),
  // Staged source snapshots plus permanent ID redirects; no legacy media copy.
  skillMigrationAliases: defineTable({
    ownerUserId: v.string(),
    sourceKind: v.union(v.literal("workflow"), v.literal("pack")),
    sourceId: v.string(),
    skillId: v.id("skills"),
    phase: v.union(v.literal("copied"), v.literal("rewired"), v.literal("retired")),
    sourceSnapshot: v.string(),
    // Append-only owner-reviewed external deletions; sourceSnapshot is immutable.
    effectiveCheckpoints: v.optional(v.array(v.object({
      phase: v.union(v.literal("rewired"), v.literal("retired")),
      missingAssetIds: v.array(v.id("assets")),
      compactedPackIds: v.array(v.id("assetPacks")),
      effectiveSnapshot: v.string(),
      recordedAt: v.number(),
    }))),
    // Repair only a proven missing/foreign cover using an existing owned example.
    coverRepairAssetId: v.optional(v.id("assets")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_source", ["ownerUserId", "sourceId"])
    .index("by_source", ["sourceKind", "sourceId"])
    .index("by_skill", ["skillId"])
    .index("by_owner_phase", ["ownerUserId", "phase"]),
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
    .index("by_owner_workflowType_createdAt", ["ownerUserId", "workflowType", "createdAt"])
    .index("by_owner_sourceFingerprint", ["ownerUserId", "sourceFingerprint"])
    .index("by_owner_folder_createdAt", ["ownerUserId", "folderId", "createdAt"])
    .searchIndex("search_text", { searchField: "searchText" }),
  // Saved social posts (X for now). One row per post per owner; re-saving the
  // same post refreshes its metadata and files it into more collections. The
  // post's preview image is a regular asset (assetRole "bookmark",
  // bookmarkId -> this row), so collections, search and the grid all work
  // through the asset. Media already saved from the post points here as well;
  // `assetId` is the one piece the Bookmarks tab shows for the post. Post fields are source metadata captured from the page;
  // `userNote` is the owner's own words.
  bookmarks: defineTable({
    ownerUserId: v.string(),
    ...bookmarkPostFields,
    userNote: v.optional(v.string()),
    assetId: v.optional(v.id("assets")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_platform_externalId", ["ownerUserId", "platform", "externalId"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"])
    .index("by_asset", ["assetId"]),
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
  // Video references: one row per YouTube video per owner. Research on what
  // performs and how it looks, kept apart from assets so a batch of several
  // hundred never floods the grid. The thumbnail and the in-video frames are
  // copied to R2 at save time (`thumbR2Key`, `frames`), so the look survives
  // the video being taken down. `collections` are plain labels used as
  // filters in the Videos tab (e.g. "youtube-cars-competitors"), not folders.
  // Channel fields are a snapshot at save time; `userNote` and `isLiked` are
  // the owner's own.
  videoRefs: defineTable({
    ownerUserId: v.string(),
    platform: v.literal("youtube"),
    externalId: v.string(),
    url: v.string(),
    title: v.string(),
    channelName: v.optional(v.string()),
    channelHandle: v.optional(v.string()),
    channelUrl: v.optional(v.string()),
    subscribers: v.optional(v.number()),
    medianViews: v.optional(v.number()),
    views: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    // The channel's best performer in the window the research looked at.
    isChannelBest: v.optional(v.boolean()),
    // When the channel last uploaded, as seen at `checkedAt`: is it alive.
    channelLastUploadAt: v.optional(v.number()),
    // When the numbers on this row were last verified on YouTube.
    checkedAt: v.optional(v.number()),
    collections: v.array(v.string()),
    topic: v.optional(v.string()),
    styleFamily: v.optional(v.string()),
    // How the picture is made: "2D animation", "Stock footage", "AI pictures"…
    productionStyle: v.optional(v.string()),
    // Spoken language, a lowercase ISO 639-1 code: "en", "es", "id".
    language: v.optional(v.string()),
    styleDescription: v.optional(v.string()),
    format: v.optional(v.string()),
    whyItWorks: v.optional(v.string()),
    hook: v.optional(v.string()),
    titlePattern: v.optional(v.string()),
    thumbnailPattern: v.optional(v.string()),
    audience: v.optional(v.string()),
    bendIdea: v.optional(v.string()),
    agentDescription: v.optional(v.string()),
    tagNames: v.array(v.string()),
    thumbR2Key: v.optional(v.string()),
    frames: v.array(
      v.object({
        r2Key: v.string(),
        label: v.optional(v.string()),
        sourceKind: v.optional(v.union(v.literal("youtube-auto-still"), v.literal("supplied-still"))),
        sourceUrl: v.optional(v.string()),
      }),
    ),
    userNote: v.optional(v.string()),
    isLiked: v.optional(v.boolean()),
    // Lowercased title, channel, style and notes; what `search` matches.
    searchText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_platform_externalId", ["ownerUserId", "platform", "externalId"])
    .index("by_owner_createdAt", ["ownerUserId", "createdAt"]),
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
    skillId: v.optional(v.id("skills")),
    pillar: optionalPillarValidator,
    isPublic: v.boolean(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    modality: semanticModalityValidator,
    searchText: v.string(),
    contentHash: v.string(),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    // Pixel lane (image bytes; prompts/designs: their text). Optional since
    // 26 Sep 2026: an asset whose pixel embedding is still pending (the
    // multimodal model's quota is small) is indexed by its text lane alone.
    embedding: v.optional(v.array(v.float64())),
    // Text lane: an embedding of the asset's words (agent description,
    // description, prompt, tags, source) kept beside the pixel embedding, so a
    // search can match what a piece is about as well as what it looks like.
    // Absent when the asset has no text yet.
    textEmbedding: v.optional(v.array(v.float64())),
    textContentHash: v.optional(v.string()),
    scopeKey: v.string(),
    scopePillarKey: v.optional(v.string()),
    publicScopeKey: v.optional(v.string()),
    publicScopePillarKey: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_asset", ["assetId"])
    .index("by_prompt", ["promptId"])
    .index("by_designInspiration", ["designInspirationId"])
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
    })
    .vectorIndex("by_text_embedding", {
      vectorField: "textEmbedding",
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
  // Small, transactional projection for vector-hit hydration. Reading a
  // semanticDocuments row just to resolve its source otherwise also reads
  // both 3072-dimensional vectors. Legacy rows fall back until backfilled.
  semanticDocumentIdentities: defineTable({
    semanticDocumentId: v.id("semanticDocuments"),
    semanticDocumentCreationTime: v.number(),
    ownerUserId: v.string(),
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
    assetId: v.optional(v.id("assets")),
    skillId: v.optional(v.id("skills")),
    pillar: optionalPillarValidator,
    isPublic: v.boolean(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    modality: semanticModalityValidator,
  }).index("by_semanticDocument", ["semanticDocumentId"]),
  // Split semantic storage (SEMANTIC_STORAGE=dual|split, convex/semanticStorage.ts).
  // One slim entry per asset or Skill maps a vector hit to its source and
  // holds each lane's content hash; each lane's vector is a row of its own,
  // so mapping hits, reindexing and authorizing a similarity search never read
  // a vector they do not use. No entry for prompts or design inspirations:
  // nothing searches them.
  semanticEntries: defineTable({
    ownerUserId: v.string(),
    assetId: v.optional(v.id("assets")),
    skillId: v.optional(v.id("skills")),
    pillar: optionalPillarValidator,
    isPublic: v.boolean(),
    modality: semanticModalityValidator,
    // Only real image embeddings; an imageless asset is found by its words.
    pixelVectorId: v.optional(v.id("semanticPixelVectors")),
    // Absent beside a vector = kept for search but due for re-embedding.
    pixelHash: v.optional(v.string()),
    textVectorId: v.optional(v.id("semanticTextVectors")),
    textHash: v.optional(v.string()),
  })
    .index("by_asset", ["assetId"])
    .index("by_skill", ["skillId"])
    .index("by_pixelVector", ["pixelVectorId"])
    .index("by_textVector", ["textVectorId"]),
  semanticPixelVectors: defineTable(semanticVectorFields)
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: SEMANTIC_VECTOR_DIMENSIONS,
      filterFields: ["scopeKey", "scopePillarKey", "publicScopeKey", "publicScopePillarKey"],
    }),
  semanticTextVectors: defineTable(semanticVectorFields)
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: SEMANTIC_VECTOR_DIMENSIONS,
      filterFields: ["scopeKey", "scopePillarKey", "publicScopeKey", "publicScopePillarKey"],
    }),
  // Cached agent inventory (convex/inventoryExport.ts): the complete default
  // asset listing written to R2 as JSON parts, so an agent downloads one
  // snapshot instead of paging every asset with its prompt, tags and
  // collections. One row per owner; a rebuild writes new objects, then
  // deletes the previous ones.
  inventoryExports: defineTable({
    ownerUserId: v.string(),
    generatedAt: v.optional(v.number()),
    assetCount: v.number(),
    folderCount: v.number(),
    byteSize: v.number(),
    parts: v.array(v.object({ key: v.string(), count: v.number(), bytes: v.number() })),
    // Newest asset createdAt in the snapshot: later reads append assets saved
    // since without reading the rest again.
    newestCreatedAt: v.optional(v.number()),
    // Set while a rebuild runs, so concurrent requests do not build twice.
    buildingSince: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerUserId"]),
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
