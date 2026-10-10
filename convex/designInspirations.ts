import {
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { bumpTagUsage, dedupeIds } from "./helpers";
import { ensureFolderOwnership } from "./folderHelpers";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import {
  designCaptureKindValidator,
  designInspirationStatusValidator,
  designInspirationTypeValidator,
  designPlatformValidator,
  designSaveIntentValidator,
  optionalPillarValidator,
  workflowTypeValidator,
} from "./validators";
import { ownerMutation, ownerQuery } from "./actor";

const designInspirationResultValidator = v.object({
  _id: v.id("designInspirations"),
  _creationTime: v.number(),
  ownerUserId: v.optional(v.string()),
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
});

const designGalleryEntryResultValidator = v.object({
  ...designInspirationResultValidator.fields,
  tagNames: v.array(v.string()),
  previewUrl: v.optional(v.string()),
  previewThumbUrl: v.optional(v.string()),
  previewWidth: v.optional(v.number()),
  previewHeight: v.optional(v.number()),
});
const reindexDesignInspirationAction = makeFunctionReference<"action">(
  "semanticIndex:reindexDesignInspiration",
);
const reindexAssetAction = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);

const buildSearchText = (values: Array<string | undefined>) =>
  values
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
    .join(" ");

const parseSourceDomain = (sourceUrl?: string) => {
  const normalized = sourceUrl?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const dedupeInspirationIds = <T extends { _id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._id)) return false;
    seen.add(row._id);
    return true;
  });
};

const resolveTagNameMap = async (
  ctx: QueryCtx,
  inspirations: Doc<"designInspirations">[],
) => {
  const tagIds = dedupeIds(inspirations.flatMap((inspiration) => inspiration.tagIds));
  if (tagIds.length === 0) {
    return new Map<Id<"tags">, string>();
  }

  const entries = await Promise.all(
    tagIds.map(async (tagId) => {
      const tag = await ctx.db.get(tagId);
      return [tagId, tag?.name] as const;
    }),
  );

  return new Map(
    entries.filter((entry): entry is [Id<"tags">, string] => Boolean(entry[1])),
  );
};

const resolvePreviewMap = async (
  ctx: QueryCtx,
  inspirations: Doc<"designInspirations">[],
) => {
  const assetIds = dedupeIds(
    inspirations
      .map((inspiration) => inspiration.assetId)
      .filter((assetId): assetId is Id<"assets"> => Boolean(assetId)),
  );
  const assets = await Promise.all(assetIds.map(async (assetId) => await ctx.db.get(assetId)));
  const previewEntries = await Promise.all(
    assets
      .filter((asset): asset is Doc<"assets"> => Boolean(asset))
      .map(async (asset) => {
        const [previewUrl, previewThumbUrl] = await Promise.all([
          resolveAssetUrl(ctx, asset),
          resolveAssetThumbUrl(ctx, asset),
        ]);

        return [
          asset._id,
          {
            previewUrl,
            previewThumbUrl,
            previewWidth: asset.width,
            previewHeight: asset.height,
          },
        ] as const;
      }),
  );

  return new Map(previewEntries);
};

const ensureLinkedOwnership = async (
  ctx: MutationCtx,
  ownerUserId: string,
  args: { assetId?: Id<"assets">; promptId?: Id<"prompts"> },
): Promise<{ assetId?: Id<"assets">; promptId?: Id<"prompts"> }> => {
  let assetId = args.assetId;
  let promptId = args.promptId;
  if (args.assetId) {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      // A previously linked asset may have been deleted independently. Keep
      // the inspiration record usable and discard only the stale reference.
      assetId = undefined;
    } else if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Linked asset does not belong to this user.");
    }
  }

  if (args.promptId) {
    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) {
      promptId = undefined;
    } else if (!canActorAccessOwnerUserId(ownerUserId, prompt.ownerUserId)) {
      throw new ConvexError("Linked prompt does not belong to this user.");
    }
  }

  return { assetId, promptId };
};

export const createDesignInspiration = ownerMutation({
  args: {
    ownerUserId: v.string(),
    pillar: v.optional(optionalPillarValidator),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    userNote: v.optional(v.string()),
    inspirationType: designInspirationTypeValidator,
    platform: designPlatformValidator,
    workflowType: workflowTypeValidator,
    captureKind: v.optional(designCaptureKindValidator),
    saveIntent: v.optional(designSaveIntentValidator),
    templateKey: v.optional(v.string()),
    sourceFingerprint: v.optional(v.string()),
    status: designInspirationStatusValidator,
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    assetId: v.optional(v.id("assets")),
    promptId: v.optional(v.id("prompts")),
  },
  returns: v.object({
    designInspirationId: v.id("designInspirations"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const title = args.title?.trim() || undefined;
    const summary = args.summary?.trim() || undefined;
    const description = args.description?.trim() || undefined;
    const sourceUrl = args.sourceUrl?.trim() || undefined;
    const sourceTitle = args.sourceTitle?.trim() || undefined;
    const userNote = args.userNote?.trim() || undefined;
    const linked = await ensureLinkedOwnership(ctx, ownerUserId, {
      assetId: args.assetId,
      promptId: args.promptId,
    });
    if (
      !title &&
      !summary &&
      !description &&
      !sourceUrl &&
      !sourceTitle &&
      !userNote &&
      !linked.assetId &&
      !linked.promptId
    ) {
      throw new ConvexError("Design inspiration requires content or linked records.");
    }

    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);
    if (args.ingestKey) {
      const existing = await ctx.db
        .query("designInspirations")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("ingestKey", args.ingestKey),
        )
        .unique();
      if (existing) {
        return { designInspirationId: existing._id, created: false };
      }
    }

    const tagIds = dedupeIds(args.tagIds);
    const now = Date.now();
    const designInspirationId = await ctx.db.insert("designInspirations", {
      ownerUserId,
      pillar: args.pillar ?? "designs",
      title,
      summary,
      description,
      sourceUrl,
      sourceTitle,
      userNote,
      sourceDomain: parseSourceDomain(sourceUrl),
      captureKind: args.captureKind,
      saveIntent: args.saveIntent,
      templateKey: args.templateKey?.trim() || undefined,
      sourceFingerprint: args.sourceFingerprint?.trim() || undefined,
      searchText: buildSearchText([title, sourceTitle, summary, description, userNote, sourceUrl]),
      inspirationType: args.inspirationType,
      platform: args.platform,
      workflowType: args.workflowType,
      status: args.status ?? "active",
      tagIds,
      folderId: args.folderId,
      ingestKey: args.ingestKey,
      assetId: linked.assetId,
      promptId: linked.promptId,
      createdAt: now,
      updatedAt: now,
    });

    for (const tagId of tagIds) {
      await ctx.db.insert("designInspirationTags", {
        designInspirationId,
        tagId,
        createdAt: now,
      });
    }
    await bumpTagUsage(ctx, tagIds, 1);

    if (linked.assetId) {
      await ctx.db.patch(linked.assetId, { designInspirationId });
    }
    await ctx.scheduler.runAfter(0, reindexDesignInspirationAction, {
      designInspirationId,
    });
    if (linked.assetId) {
      await ctx.scheduler.runAfter(0, reindexAssetAction, {
        assetId: linked.assetId,
      });
    }

    return { designInspirationId, created: true };
  },
});

export const updateDesignInspiration = ownerMutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("designInspirations"),
    pillar: v.optional(optionalPillarValidator),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    userNote: v.optional(v.string()),
    inspirationType: designInspirationTypeValidator,
    platform: designPlatformValidator,
    workflowType: workflowTypeValidator,
    captureKind: v.optional(designCaptureKindValidator),
    saveIntent: v.optional(designSaveIntentValidator),
    templateKey: v.optional(v.string()),
    sourceFingerprint: v.optional(v.string()),
    status: designInspirationStatusValidator,
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    assetId: v.optional(v.id("assets")),
    promptId: v.optional(v.id("prompts")),
  },
  returns: v.id("designInspirations"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError("Design inspiration not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, existing.ownerUserId)) {
      throw new ConvexError("Design inspiration does not belong to this user.");
    }

    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);
    const linked = await ensureLinkedOwnership(ctx, ownerUserId, {
      assetId: args.assetId,
      promptId: args.promptId,
    });

    const title = args.title?.trim() || undefined;
    const summary = args.summary?.trim() || undefined;
    const description = args.description?.trim() || undefined;
    const sourceUrl = args.sourceUrl?.trim() || undefined;
    const sourceTitle = args.sourceTitle?.trim() || undefined;
    const userNote = args.userNote?.trim() || undefined;
    if (
      !title &&
      !summary &&
      !description &&
      !sourceUrl &&
      !sourceTitle &&
      !userNote &&
      !linked.assetId &&
      !linked.promptId
    ) {
      throw new ConvexError("Design inspiration requires content or linked records.");
    }

    const tagIds = dedupeIds(args.tagIds);
    const updatedAt = Date.now();
    const patchPayload: Record<string, unknown> = {
      title,
      summary,
      description,
      sourceUrl,
      sourceTitle,
      userNote,
      sourceDomain: parseSourceDomain(sourceUrl),
      captureKind: args.captureKind,
      saveIntent: args.saveIntent,
      templateKey: args.templateKey?.trim() || undefined,
      sourceFingerprint: args.sourceFingerprint?.trim() || undefined,
      searchText: buildSearchText([title, sourceTitle, summary, description, userNote, sourceUrl]),
      inspirationType: args.inspirationType,
      platform: args.platform,
      workflowType: args.workflowType,
      status: args.status ?? "active",
      tagIds,
      folderId: args.folderId,
      assetId: linked.assetId,
      promptId: linked.promptId,
      updatedAt,
    };
    if (args.pillar !== undefined) {
      patchPayload.pillar = args.pillar;
    }
    await ctx.db.patch(args.id, patchPayload);

    await bumpTagUsage(ctx, existing.tagIds, -1);
    await bumpTagUsage(ctx, tagIds, 1);

    const links = await ctx.db
      .query("designInspirationTags")
      .withIndex("by_designInspiration", (q) =>
        q.eq("designInspirationId", args.id),
      )
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    for (const tagId of tagIds) {
      await ctx.db.insert("designInspirationTags", {
        designInspirationId: args.id,
        tagId,
        createdAt: existing.createdAt,
      });
    }

    if (existing.assetId && existing.assetId !== linked.assetId) {
      const previousAsset = await ctx.db.get(existing.assetId);
      if (previousAsset?.designInspirationId === args.id) {
        await ctx.db.patch(existing.assetId, { designInspirationId: undefined });
      }
    }
    if (linked.assetId) {
      await ctx.db.patch(linked.assetId, { designInspirationId: args.id });
    }
    await ctx.scheduler.runAfter(0, reindexDesignInspirationAction, {
      designInspirationId: args.id,
    });
    if (existing.assetId) {
      await ctx.scheduler.runAfter(0, reindexAssetAction, {
        assetId: existing.assetId,
      });
    }
    if (linked.assetId && linked.assetId !== existing.assetId) {
      await ctx.scheduler.runAfter(0, reindexAssetAction, {
        assetId: linked.assetId,
      });
    }

    return args.id;
  },
});

export const getDesignInspiration = ownerQuery({
  args: {
    id: v.id("designInspirations"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(v.null(), designInspirationResultValidator),
  handler: async (ctx, args) => {
    const inspiration = await ctx.db.get(args.id);
    if (!inspiration) {
      return null;
    }
    if (args.ownerUserId && !canActorAccessOwnerUserId(args.ownerUserId, inspiration.ownerUserId)) {
      return null;
    }
    return inspiration;
  },
});

export const getDesignInspirationIdForIngestKey = internalQuery({
  args: {
    ownerUserId: v.string(),
    ingestKey: v.string(),
  },
  returns: v.union(v.null(), v.id("designInspirations")),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const ingestKey = args.ingestKey.trim();
    if (!ownerUserId || !ingestKey) {
      return null;
    }

    const existing = await ctx.db
      .query("designInspirations")
      .withIndex("by_owner_ingestKey", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("ingestKey", ingestKey),
      )
      .unique();

    return existing?._id ?? null;
  },
});

export const getDesignInspirationIdForSourceFingerprint = internalQuery({
  args: {
    ownerUserId: v.string(),
    sourceFingerprint: v.string(),
  },
  returns: v.union(v.null(), v.id("designInspirations")),
  handler: async (ctx, args) => {
    const ownerUserIds = resolveUserIdCandidates(args.ownerUserId.trim());
    const sourceFingerprint = args.sourceFingerprint.trim();
    if (!sourceFingerprint) {
      return null;
    }

    for (const ownerCandidate of ownerUserIds) {
      const existing = await ctx.db
        .query("designInspirations")
        .withIndex("by_owner_sourceFingerprint", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("sourceFingerprint", sourceFingerprint),
        )
        .unique();
      if (existing) {
        return existing._id;
      }
    }

    return null;
  },
});

export const listDesignInspirations = ownerQuery({
  args: {
    ownerUserId: v.string(),
    tagId: v.optional(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    inspirationType: v.optional(designInspirationTypeValidator),
    workflowType: workflowTypeValidator,
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(designInspirationResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const limit = Math.min(args.limit ?? 100, 2000);
    const search = args.search?.trim().toLowerCase();
    const tagId = args.tagId;
    const inspirationType = args.inspirationType;
    const workflowType = args.workflowType;
    const folderId = args.folderId;

    if (tagId) {
      const links = await ctx.db
        .query("designInspirationTags")
        .withIndex("by_tag_createdAt", (q) => q.eq("tagId", tagId).gte("createdAt", 0))
        .order("desc")
        .take(limit * 2);
      const results: Doc<"designInspirations">[] = [];
      for (const link of links) {
        const inspiration = await ctx.db.get(link.designInspirationId);
        if (inspiration && canActorAccessOwnerUserId(ownerUserId, inspiration.ownerUserId)) {
          results.push(inspiration);
        }
      }
      const deduped = dedupeInspirationIds(results).slice(0, limit);
      if (!search) {
        return deduped;
      }
      return deduped.filter((item) => item.searchText.includes(search)).slice(0, limit);
    }

    const rows: Doc<"designInspirations">[] = [];
    for (const ownerCandidate of ownerUserIds) {
      const scoped = await (inspirationType
        ? ctx.db
            .query("designInspirations")
            .withIndex("by_owner_inspirationType_createdAt", (q) =>
              q.eq("ownerUserId", ownerCandidate)
                .eq("inspirationType", inspirationType)
                .gte("createdAt", 0),
            )
        : workflowType
          ? ctx.db
              .query("designInspirations")
              .withIndex("by_owner_workflowType_createdAt", (q) =>
                q.eq("ownerUserId", ownerCandidate)
                  .eq("workflowType", workflowType)
                  .gte("createdAt", 0),
              )
          : folderId
            ? ctx.db
                .query("designInspirations")
                .withIndex("by_owner_folder_createdAt", (q) =>
                  q.eq("ownerUserId", ownerCandidate)
                    .eq("folderId", folderId)
                    .gte("createdAt", 0),
                )
            : ctx.db
                .query("designInspirations")
                .withIndex("by_owner_createdAt", (q) =>
                  q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
                ))
        .order("desc")
        .take(limit);
      rows.push(...scoped);
    }

    const deduped = dedupeInspirationIds(rows)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    if (!search) {
      return deduped;
    }
    return deduped.filter((item) => item.searchText.includes(search)).slice(0, limit);
  },
});

export const listDesignGalleryEntries = ownerQuery({
  args: {
    ownerUserId: v.string(),
    pillar: v.optional(optionalPillarValidator),
    tagIds: v.optional(v.array(v.id("tags"))),
    matchAllTags: v.optional(v.boolean()),
    folderId: v.optional(v.id("folders")),
    inspirationType: v.optional(designInspirationTypeValidator),
    platform: designPlatformValidator,
    workflowType: workflowTypeValidator,
    captureKind: v.optional(designCaptureKindValidator),
    saveIntent: v.optional(designSaveIntentValidator),
    sourceDomain: v.optional(v.string()),
    search: v.optional(v.string()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    requireAsset: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(designGalleryEntryResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const limit = Math.min(args.limit ?? 50, 2000);
    const takeLimit = Math.min(Math.max(limit * 4, 100), 2000);
    const search = args.search?.trim().toLowerCase();
    const sourceDomain = args.sourceDomain?.trim().toLowerCase();
    const tagIds = dedupeIds(args.tagIds ?? []);

    const rows: Doc<"designInspirations">[] = [];
    for (const ownerCandidate of ownerUserIds) {
      const scoped = await ctx.db
        .query("designInspirations")
        .withIndex("by_owner_createdAt", (q) =>
          q.eq("ownerUserId", ownerCandidate).gte("createdAt", args.dateFrom ?? 0),
        )
        .order("desc")
        .take(takeLimit);
      rows.push(...scoped);
    }

    const pillarFilter = args.pillar;
    const prefiltered = dedupeInspirationIds(rows)
      .filter((item) =>
        pillarFilter ? (item.pillar ?? "designs") === pillarFilter : true,
      )
      .filter((item) => (args.folderId ? item.folderId === args.folderId : true))
      .filter((item) =>
        args.inspirationType ? item.inspirationType === args.inspirationType : true,
      )
      .filter((item) => (args.platform ? item.platform === args.platform : true))
      .filter((item) => (args.workflowType ? item.workflowType === args.workflowType : true))
      .filter((item) => (args.captureKind ? item.captureKind === args.captureKind : true))
      .filter((item) => (args.saveIntent ? item.saveIntent === args.saveIntent : true))
      .filter((item) => (sourceDomain ? item.sourceDomain === sourceDomain : true))
      .filter((item) => (args.dateTo ? item.createdAt <= args.dateTo : true))
      .filter((item) => (args.requireAsset ? Boolean(item.assetId) : true))
      .filter((item) => {
        if (tagIds.length === 0) {
          return true;
        }
        return args.matchAllTags
          ? tagIds.every((tagId) => item.tagIds.includes(tagId))
          : tagIds.some((tagId) => item.tagIds.includes(tagId));
      })
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);

    const [tagNameById, previewByAssetId] = await Promise.all([
      resolveTagNameMap(ctx, prefiltered),
      resolvePreviewMap(ctx, prefiltered),
    ]);

    return prefiltered
      .map((item) => {
        const preview = item.assetId ? previewByAssetId.get(item.assetId) : undefined;
        const tagNames = item.tagIds
          .map((tagId) => tagNameById.get(tagId))
          .filter((tagName): tagName is string => Boolean(tagName));
        return {
          ...item,
          tagNames,
          previewUrl: preview?.previewUrl,
          previewThumbUrl: preview?.previewThumbUrl,
          previewWidth: preview?.previewWidth,
          previewHeight: preview?.previewHeight,
        };
      })
      .filter((item) => {
        if (!search) {
          return true;
        }
        return `${item.searchText} ${item.tagNames.join(" ")}`.includes(search);
      });
  },
});

export const deleteDesignInspiration = ownerMutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("designInspirations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const inspiration = await ctx.db.get(args.id);
    if (!inspiration) {
      throw new ConvexError("Design inspiration not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, inspiration.ownerUserId)) {
      throw new ConvexError("Design inspiration does not belong to this user.");
    }

    const links = await ctx.db
      .query("designInspirationTags")
      .withIndex("by_designInspiration", (q) =>
        q.eq("designInspirationId", args.id),
      )
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    if (inspiration.assetId) {
      const linkedAsset = await ctx.db.get(inspiration.assetId);
      if (linkedAsset?.designInspirationId === args.id) {
        await ctx.db.patch(inspiration.assetId, { designInspirationId: undefined });
      }
    }

    await ctx.db.delete(args.id);
    await bumpTagUsage(ctx, dedupeIds(inspiration.tagIds), -1);
    await ctx.scheduler.runAfter(0, reindexDesignInspirationAction, {
      designInspirationId: args.id,
    });
    if (inspiration.assetId) {
      await ctx.scheduler.runAfter(0, reindexAssetAction, {
        assetId: inspiration.assetId,
      });
    }
    return null;
  },
});
