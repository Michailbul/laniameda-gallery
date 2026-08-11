import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  reconcileAssetPackMembership,
  syncPromptAssetPack,
} from "./assetPackHelpers";
import { bumpTagUsage, canonicalTagKey, dedupeIds, normalizeTagName } from "./helpers";
import { ensureFolderOwnership, recountFolderMembers } from "./folderHelpers";
import { r2 } from "./r2";
import {
  galleryAssetResultValidator,
  hydrateGalleryAssetResults,
} from "./galleryAssetResults";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  canActorAccessByUserId,
  canActorAccessOwnerUserId,
  parseUserIdList,
  resolveUserIdCandidates,
} from "./authz";
import {
  assetDocValidator,
  assetRoleValidator,
  cinemaMetadataValidator,
  generationTypeValidator,
  ingestSourceValidator,
  optionalPillarValidator,
  projectSectionFilterValidator,
} from "./validators";

const pillarValidator = optionalPillarValidator;
// Which project layer the grid is narrowed to; undefined = the "All" tab.
type ProjectSectionFilter =
  | "characters"
  | "locations"
  | "stills"
  | "beats"
  | "episodes"
  | "unsorted";
const reindexAssetAction = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);
const reindexPromptAction = makeFunctionReference<"action">(
  "semanticIndex:reindexPrompt",
);

const nullableStringValidator = v.optional(v.union(v.null(), v.string()));
const assetKindValidator = v.union(v.literal("image"), v.literal("video"));
const optionalAssetKindValidator = v.optional(assetKindValidator);
const nullableGenerationTypeValidator = v.optional(v.union(
  v.null(),
  v.literal("image_gen"),
  v.literal("video_gen"),
  v.literal("ui_design"),
  v.literal("workflow"),
  v.literal("other"),
));
const nullableAssetRoleValidator = v.optional(v.union(
  v.null(),
  v.literal("generated_output"),
  v.literal("reference"),
  v.literal("inspiration_capture"),
  v.literal("workflow_asset"),
  v.literal("cinema_frame"),
  v.literal("other"),
));
const nullableIngestSourceValidator = v.optional(v.union(
  v.null(),
  v.literal("api"),
  v.literal("agent"),
  v.literal("telegram"),
  v.literal("manual"),
  v.literal("import"),
));

const normalizeOptionalString = (value: string | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getCuratorUserIdsFromEnv = () => {
  return parseUserIdList(
    process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID,
  );
};

const assertCurationAdmin = (actorUserId: string, adminSecret: string) => {
  const expectedSecret = process.env.CURATION_ADMIN_SECRET;
  if (!expectedSecret || adminSecret !== expectedSecret) {
    throw new ConvexError("Unauthorized admin request.");
  }
  const trimmedActor = actorUserId.trim();
  if (!trimmedActor) {
    throw new ConvexError("actorUserId is required.");
  }
  const allowedUserIds = getCuratorUserIdsFromEnv();
  if (allowedUserIds.length === 0) {
    throw new ConvexError("Admin user list is not configured.");
  }
  if (!canActorAccessByUserId(trimmedActor, allowedUserIds)) {
    throw new ConvexError("Forbidden admin actor.");
  }
};

const hasOwn = <T extends object>(value: T, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

const resolveTagIdsForNames = async (
  ctx: MutationCtx,
  names: string[],
  pillar: string | undefined,
) => {
  const cleanedNames = Array.from(
    new Set(names.map((name) => name.trim()).filter(Boolean)),
  );
  if (cleanedNames.length === 0) {
    return [] as Id<"tags">[];
  }

  // Per-name indexed lookups (by_normalized, then by_canonicalKey) replace
  // the old full tags-table scan on every ingest.
  const resolvedByCanonical = new Map<string, Id<"tags">>();
  const tagIds: Id<"tags">[] = [];
  for (const name of cleanedNames) {
    const normalized = normalizeTagName(name);
    const canonical = canonicalTagKey(name);
    const cached = canonical
      ? resolvedByCanonical.get(canonical)
      : undefined;
    if (cached) {
      tagIds.push(cached);
      continue;
    }

    const existing =
      (await ctx.db
        .query("tags")
        .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
        .first()) ??
      (canonical
        ? await ctx.db
            .query("tags")
            .withIndex("by_canonicalKey", (q) =>
              q.eq("canonicalKey", canonical),
            )
            .first()
        : null);
    if (existing) {
      tagIds.push(existing._id);
      if (canonical) resolvedByCanonical.set(canonical, existing._id);
      continue;
    }

    const tagId = await ctx.db.insert("tags", {
      name,
      normalized,
      canonicalKey: canonicalTagKey(name),
      usageCount: 0,
      pillar,
      source: "user",
    });
    if (canonical) resolvedByCanonical.set(canonical, tagId);
    tagIds.push(tagId);
  }

  return dedupeIds(tagIds);
};

const replaceAssetTagLinks = async (
  ctx: MutationCtx,
  asset: Doc<"assets">,
  tagIds: Id<"tags">[],
) => {
  const nextTagIds = dedupeIds(tagIds);
  await bumpTagUsage(ctx, asset.tagIds, -1);
  await bumpTagUsage(ctx, nextTagIds, 1);

  const links = await ctx.db
    .query("assetTags")
    .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  for (const tagId of nextTagIds) {
    await ctx.db.insert("assetTags", {
      assetId: asset._id,
      tagId,
      createdAt: asset.createdAt,
    });
  }
};

const replacePromptTagLinks = async (
  ctx: MutationCtx,
  prompt: Doc<"prompts">,
  tagIds: Id<"tags">[],
) => {
  const nextTagIds = dedupeIds(tagIds);
  await bumpTagUsage(ctx, prompt.tagIds, -1);
  await bumpTagUsage(ctx, nextTagIds, 1);

  const links = await ctx.db
    .query("promptTags")
    .withIndex("by_prompt", (q) => q.eq("promptId", prompt._id))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  for (const tagId of nextTagIds) {
    await ctx.db.insert("promptTags", {
      promptId: prompt._id,
      tagId,
      createdAt: prompt.createdAt,
    });
  }
};

const dedupeAssetIds = <T extends { _id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._id)) return false;
    seen.add(row._id);
    return true;
  });
};

const dedupeFolderIds = (folderIds: Array<Id<"folders"> | undefined>) =>
  dedupeIds(
    folderIds.filter((folderId): folderId is Id<"folders"> =>
      Boolean(folderId),
    ),
  );

const getAssetFolderLinks = async (
  ctx: QueryCtx | MutationCtx,
  assetId: Id<"assets">,
) =>
  await ctx.db
    .query("assetFolders")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .collect();

const addAssetFolderLink = async (
  ctx: MutationCtx,
  ownerUserId: string,
  assetId: Id<"assets">,
  folderId: Id<"folders">,
) => {
  const existing = await ctx.db
    .query("assetFolders")
    .withIndex("by_asset_folder", (q) =>
      q.eq("assetId", assetId).eq("folderId", folderId),
    )
    .unique();
  if (existing) {
    return;
  }

  await ctx.db.insert("assetFolders", {
    ownerUserId,
    assetId,
    folderId,
    createdAt: Date.now(),
  });
  await recountFolderMembers(ctx, [folderId]);
};

const replaceAssetFolderLinks = async (
  ctx: MutationCtx,
  ownerUserId: string,
  asset: Doc<"assets">,
  folderIds: Id<"folders">[],
) => {
  const nextFolderIds = dedupeFolderIds(folderIds);
  for (const folderId of nextFolderIds) {
    await ensureFolderOwnership(ctx, ownerUserId, folderId);
  }

  const existingLinks = await getAssetFolderLinks(ctx, asset._id);
  const nextSet = new Set(nextFolderIds);

  const removedFolderIds: Id<"folders">[] = [];
  for (const link of existingLinks) {
    if (!nextSet.has(link.folderId)) {
      await ctx.db.delete(link._id);
      removedFolderIds.push(link.folderId);
    }
  }
  await recountFolderMembers(ctx, removedFolderIds);

  const existingSet = new Set(existingLinks.map((link) => link.folderId));
  for (const folderId of nextFolderIds) {
    if (!existingSet.has(folderId)) {
      await addAssetFolderLink(ctx, ownerUserId, asset._id, folderId);
    }
  }

  const primaryFolderId = nextFolderIds[0];
  if (asset.folderId !== primaryFolderId) {
    await ctx.db.patch(asset._id, {
      folderId: primaryFolderId,
    });
  }

  return {
    folderId: primaryFolderId,
    folderIds: nextFolderIds,
  };
};

// Move the asset's PRIMARY collection without touching its other memberships
// (beats, storybooks, extra collections). Replaces the old primary's link with
// the new one; undefined clears the primary and only that membership. This is
// the single-folder edit semantic — replaceAssetFolderLinks stays reserved for
// the explicit multi-select (setAssetFolders), which intentionally replaces
// the full set.
const setPrimaryAssetFolder = async (
  ctx: MutationCtx,
  ownerUserId: string,
  asset: Doc<"assets">,
  nextFolderId: Id<"folders"> | undefined,
) => {
  await ensureFolderOwnership(ctx, ownerUserId, nextFolderId);

  const previousPrimary = asset.folderId;
  if (previousPrimary && previousPrimary !== nextFolderId) {
    const links = await getAssetFolderLinks(ctx, asset._id);
    for (const link of links) {
      if (link.folderId === previousPrimary) {
        await ctx.db.delete(link._id);
      }
    }
    await recountFolderMembers(ctx, [previousPrimary]);
  }

  if (nextFolderId) {
    await addAssetFolderLink(ctx, ownerUserId, asset._id, nextFolderId);
  }

  if (asset.folderId !== nextFolderId) {
    await ctx.db.patch(asset._id, { folderId: nextFolderId });
  }

  const remainingLinks = await getAssetFolderLinks(ctx, asset._id);
  return {
    folderId: nextFolderId,
    folderIds: dedupeFolderIds([
      nextFolderId,
      ...remainingLinks.map((link) => link.folderId),
    ]),
  };
};

// Membership reads are LINKS-ONLY: assetFolders is the single source of
// truth (verified drift-free via membershipAudit:run before the switch).
// assets.folderId survives purely as the "primary collection" pointer.
export const collectAssetsForFolder = async (
  ctx: QueryCtx,
  ownerUserIds: string[],
  folderId: Id<"folders">,
  limit: number,
) => {
  const linkedAssets = [];
  for (const ownerCandidate of ownerUserIds) {
    const links = await ctx.db
      .query("assetFolders")
      .withIndex("by_owner_folder_createdAt", (q) =>
        q.eq("ownerUserId", ownerCandidate).eq("folderId", folderId).gte("createdAt", 0),
      )
      .order("desc")
      .take(limit);
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (asset && canActorAccessOwnerUserId(ownerCandidate, asset.ownerUserId)) {
        linkedAssets.push(asset);
      }
    }
  }

  return dedupeAssetIds(linkedAssets)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

/**
 * A WORLD's whole membership: the folder's own assets plus every
 * sub-collection's ("Dear Annete" > Characters / Locations / Scenes), deduped
 * and newest-first. Browsing a world in the vault should show the world, not
 * just the loose assets that happen to sit on the parent folder.
 *
 * Nesting is capped at one level (see folders.assertValidParent), so this is
 * a single extra fan-out, never a recursive walk.
 *
 * A child PROJECT is the exception to the folder walk: a project holds no
 * membership links of its own, its assets live in the member collections it
 * joins through `projectCollections` ("Dari — Locations", each beat), and those
 * are not child folders. Walking children alone therefore skipped a world's
 * whole project pool — Dear Annete's 27 Dari locations were invisible under the
 * world's Locations filter even though they carry the tag.
 */
export const collectAssetsForFolderTree = async (
  ctx: QueryCtx,
  ownerUserIds: string[],
  folderId: Id<"folders">,
  limit: number,
) => {
  const children = await ctx.db
    .query("folders")
    .withIndex("by_parent", (q) => q.eq("parentFolderId", folderId))
    .collect();
  const folderIds = [folderId, ...children.map((child) => child._id)];

  const collected: Doc<"assets">[] = [];
  for (const id of folderIds) {
    collected.push(
      ...(await collectAssetsForFolder(ctx, ownerUserIds, id, limit)),
    );
  }
  for (const child of children) {
    if (child.kind !== "project") continue;
    collected.push(
      ...(await collectAssetsForProject(ctx, ownerUserIds, child._id, limit)),
    );
  }
  return dedupeAssetIds(collected)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

const collectAssetIdsForFolder = async (
  ctx: QueryCtx,
  folderId: Id<"folders">,
  limit: number,
) => {
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_folder_createdAt", (q) =>
      q.eq("folderId", folderId).gte("createdAt", 0),
    )
    .order("desc")
    .take(limit);

  return new Set<Id<"assets">>(links.map((link) => link.assetId));
};

export const createAsset = mutation({
  args: {
    ownerUserId: v.string(),
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
    /** SHA-256 of the media bytes, hex — see the schema note on assets. */
    contentHash: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
    cinemaMetadata: cinemaMetadataValidator,
  },
  returns: v.object({
    assetId: v.id("assets"),
    created: v.boolean(),
    /** True when identical BYTES were already in the vault. */
    duplicate: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);

    if (args.ingestKey) {
      const existing = await ctx.db
        .query("assets")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("ingestKey", args.ingestKey),
        )
        .unique();
      if (existing) {
        if (args.folderId) {
          await addAssetFolderLink(ctx, ownerUserId, existing._id, args.folderId);
          if (!existing.folderId) {
            await ctx.db.patch(existing._id, { folderId: args.folderId });
          }
        }
        return { assetId: existing._id, created: false };
      }
    }

    // Same bytes already in the vault → file them where the caller asked and
    // hand back the original. This catches what ingestKey can't: the same image
    // re-downloaded under another name, or saved from a second URL.
    if (args.contentHash) {
      const twin = await ctx.db
        .query("assets")
        .withIndex("by_owner_contentHash", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("contentHash", args.contentHash),
        )
        .first();
      if (twin) {
        if (args.folderId) {
          await addAssetFolderLink(ctx, ownerUserId, twin._id, args.folderId);
          if (!twin.folderId) {
            await ctx.db.patch(twin._id, { folderId: args.folderId });
          }
        }
        // Tags are additive here: a second save often carries better tags than
        // the first, and dropping them would lose the only new information.
        const extraTagIds = dedupeIds(args.tagIds).filter(
          (tagId) => !twin.tagIds.includes(tagId),
        );
        if (extraTagIds.length > 0) {
          const nextTagIds = dedupeIds([...twin.tagIds, ...extraTagIds]);
          await ctx.db.patch(twin._id, { tagIds: nextTagIds });
          for (const tagId of extraTagIds) {
            await ctx.db.insert("assetTags", {
              assetId: twin._id,
              tagId,
              createdAt: twin.createdAt ?? Date.now(),
            });
          }
          await bumpTagUsage(ctx, extraTagIds, 1);
        }
        return { assetId: twin._id, created: false, duplicate: true };
      }
    }

    const createdAt = Date.now();
    const tagIds = dedupeIds(args.tagIds);
    const assetId = await ctx.db.insert("assets", {
      ownerUserId,
      kind: args.kind,
      storageId: args.storageId,
      thumbStorageId: args.thumbStorageId,
      r2Key: args.r2Key,
      r2Bucket: args.r2Bucket,
      thumbR2Key: args.thumbR2Key,
      thumbR2Bucket: args.thumbR2Bucket,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      description: args.description,
      contentType: args.contentType,
      size: args.size,
      width: args.width,
      height: args.height,
      thumbSize: args.thumbSize,
      thumbWidth: args.thumbWidth,
      thumbHeight: args.thumbHeight,
      promptId: args.promptId,
      designInspirationId: args.designInspirationId,
      tagIds,
      folderId: args.folderId,
      ingestKey: args.ingestKey,
      contentHash: args.contentHash,
      modelName: args.modelName,
      isPublic: false,
      isFeatured: false,
      isLiked: false,
      pillar: args.pillar,
      generationType: args.generationType,
      assetRole: args.assetRole,
      ingestSource: args.ingestSource,
      cinemaMetadata: args.cinemaMetadata,
      createdAt,
    });

    for (const tagId of tagIds) {
      await ctx.db.insert("assetTags", {
        assetId,
        tagId,
        createdAt,
      });
    }
    if (args.folderId) {
      await addAssetFolderLink(ctx, ownerUserId, assetId, args.folderId);
    }

    await bumpTagUsage(ctx, tagIds, 1);
    if (args.promptId) {
      await syncPromptAssetPack(ctx, {
        ownerUserId,
        promptId: args.promptId,
      });
    }
    await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId });

    return { assetId, created: true };
  },
});

export const setAssetFolder = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
  },
  returns: v.object({
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
    folderIds: v.array(v.id("folders")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    const result = await setPrimaryAssetFolder(
      ctx,
      ownerUserId,
      asset,
      args.folderId,
    );

    return {
      assetId: args.assetId,
      folderId: result.folderId,
      folderIds: result.folderIds,
    };
  },
});

export const setAssetLiked = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    isLiked: v.boolean(),
  },
  returns: v.object({
    assetId: v.id("assets"),
    isLiked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    await ctx.db.patch(args.assetId, { isLiked: args.isLiked });

    return { assetId: args.assetId, isLiked: args.isLiked };
  },
});

const STAR_NOTE_MAX_LENGTH = 500;

const requireOwnedAsset = async (
  ctx: MutationCtx,
  rawOwnerUserId: string,
  assetId: Id<"assets">,
) => {
  const ownerUserId = rawOwnerUserId.trim();
  if (!ownerUserId) {
    throw new ConvexError("ownerUserId is required.");
  }
  const asset = await ctx.db.get(assetId);
  if (!asset) {
    throw new ConvexError("Asset not found.");
  }
  if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
    throw new ConvexError("Asset does not belong to this user.");
  }
  return asset;
};

// Star/unstar an asset. The star travels with the asset, so it reads the same
// wherever the asset surfaces — collection, world, project section or plain
// browse. Unstarring KEEPS any note: the note is only ever shown while starred,
// so holding it makes an accidental toggle free to undo.
export const setAssetStarred = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    starred: v.boolean(),
    // Set the note in the same round-trip as the star (the card's "star + write
    // a line" flow), so the grid re-sorts once instead of twice.
    note: v.optional(v.string()),
  },
  returns: v.object({
    assetId: v.id("assets"),
    starredAt: v.optional(v.number()),
    starNote: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const asset = await requireOwnedAsset(ctx, args.ownerUserId, args.assetId);

    const starredAt = args.starred ? Date.now() : undefined;
    const starNote =
      args.note === undefined
        ? asset.starNote
        : args.note.trim().slice(0, STAR_NOTE_MAX_LENGTH) || undefined;

    await ctx.db.patch(asset._id, { starredAt, starNote });

    return { assetId: asset._id, starredAt, starNote };
  },
});

// Edit just the note on a starred asset, without touching the star itself.
export const setAssetStarNote = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    note: v.string(),
  },
  returns: v.object({
    assetId: v.id("assets"),
    starNote: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const asset = await requireOwnedAsset(ctx, args.ownerUserId, args.assetId);
    const starNote =
      args.note.trim().slice(0, STAR_NOTE_MAX_LENGTH) || undefined;
    await ctx.db.patch(asset._id, { starNote });
    return { assetId: asset._id, starNote };
  },
});

export const setAssetFolders = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderIds: v.array(v.id("folders")),
  },
  returns: v.object({
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
    folderIds: v.array(v.id("folders")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    const result = await replaceAssetFolderLinks(
      ctx,
      ownerUserId,
      asset,
      args.folderIds,
    );

    return {
      assetId: args.assetId,
      folderId: result.folderId,
      folderIds: result.folderIds,
    };
  },
});

export const addAssetFolders = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderIds: v.array(v.id("folders")),
  },
  returns: v.object({
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
    folderIds: v.array(v.id("folders")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    const requestedFolderIds = dedupeFolderIds(args.folderIds);
    for (const folderId of requestedFolderIds) {
      await ensureFolderOwnership(ctx, ownerUserId, folderId);
    }

    const existingLinks = await getAssetFolderLinks(ctx, args.assetId);
    const folderIds = dedupeFolderIds([
      asset.folderId,
      ...existingLinks.map((link) => link.folderId),
      ...requestedFolderIds,
    ]);

    for (const folderId of folderIds) {
      await addAssetFolderLink(ctx, ownerUserId, args.assetId, folderId);
    }

    const primaryFolderId = asset.folderId ?? folderIds[0];
    if (primaryFolderId && asset.folderId !== primaryFolderId) {
      await ctx.db.patch(args.assetId, {
        folderId: primaryFolderId,
      });
    }

    return {
      assetId: args.assetId,
      folderId: primaryFolderId,
      folderIds,
    };
  },
});

// Drop ONE membership and leave every other one alone — the card's one-click
// "not relevant here". Idempotent: removing a collection the asset was never
// in reports removed: false instead of throwing, so a double click, a stale
// tile, or a retry is harmless.
export const removeAssetFolder = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderId: v.id("folders"),
  },
  returns: v.object({
    assetId: v.id("assets"),
    removed: v.boolean(),
    folderId: v.optional(v.id("folders")),
    folderIds: v.array(v.id("folders")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }
    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);

    const existingLinks = await getAssetFolderLinks(ctx, args.assetId);
    const removedLinks = existingLinks.filter(
      (link) => link.folderId === args.folderId,
    );
    for (const link of removedLinks) {
      await ctx.db.delete(link._id);
    }
    if (removedLinks.length > 0) {
      await recountFolderMembers(ctx, [args.folderId]);
    }

    const remainingFolderIds = dedupeFolderIds(
      existingLinks
        .filter((link) => link.folderId !== args.folderId)
        .map((link) => link.folderId),
    );

    // The primary pointer can't keep naming a collection the asset just left.
    let primaryFolderId = asset.folderId;
    const primaryWasRemoved = primaryFolderId === args.folderId;
    if (primaryWasRemoved) {
      primaryFolderId = remainingFolderIds[0];
      await ctx.db.patch(args.assetId, { folderId: primaryFolderId });
    }

    return {
      assetId: args.assetId,
      removed: removedLinks.length > 0 || primaryWasRemoved,
      folderId: primaryFolderId,
      folderIds: dedupeFolderIds([primaryFolderId, ...remainingFolderIds]),
    };
  },
});

export const updateAssetMetadata = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    promptId: v.optional(v.id("prompts")),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    description: v.optional(v.string()),
    contentType: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
  },
  returns: v.id("assets"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    if (args.promptId) {
      const prompt = await ctx.db.get(args.promptId);
      if (!prompt) {
        throw new ConvexError("Linked prompt not found.");
      }
      if (!canActorAccessOwnerUserId(ownerUserId, prompt.ownerUserId)) {
        throw new ConvexError("Linked prompt does not belong to this user.");
      }
    }

    const tagIds = dedupeIds(args.tagIds);
    const previousPromptId = asset.promptId;
    await ctx.db.patch(args.assetId, {
      tagIds,
      promptId: args.promptId,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      description: args.description,
      contentType: args.contentType,
      modelName: args.modelName,
      pillar: args.pillar,
      generationType: args.generationType,
      assetRole: args.assetRole,
      ingestSource: args.ingestSource,
    });
    // Primary-collection move keeps the asset's other memberships intact
    // (previously this replaced/cleared the alias while links drifted).
    await setPrimaryAssetFolder(ctx, ownerUserId, asset, args.folderId);

    await bumpTagUsage(ctx, asset.tagIds, -1);
    await bumpTagUsage(ctx, tagIds, 1);

    const links = await ctx.db
      .query("assetTags")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    for (const tagId of tagIds) {
      await ctx.db.insert("assetTags", {
        assetId: args.assetId,
        tagId,
        createdAt: asset.createdAt,
      });
    }

    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    const promptIdsToSync = Array.from(
      new Set(
        [previousPromptId, args.promptId].filter(
          (promptId): promptId is Id<"prompts"> => Boolean(promptId),
        ),
      ),
    );
    for (const promptId of promptIdsToSync) {
      await syncPromptAssetPack(ctx, {
        ownerUserId,
        promptId,
      });
    }

    return args.assetId;
  },
});

export const adminUpdateAsset = mutation({
  args: {
    assetId: v.id("assets"),
    actorUserId: v.string(),
    adminSecret: v.string(),
    description: nullableStringValidator,
    promptText: nullableStringValidator,
    tagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.union(v.null(), v.id("folders"))),
    kind: optionalAssetKindValidator,
    sourceUrl: nullableStringValidator,
    fileName: nullableStringValidator,
    contentType: nullableStringValidator,
    modelName: nullableStringValidator,
    pillar: nullableStringValidator,
    generationType: nullableGenerationTypeValidator,
    assetRole: nullableAssetRoleValidator,
    ingestSource: nullableIngestSourceValidator,
  },
  returns: v.object({
    assetId: v.id("assets"),
    promptId: v.optional(v.id("prompts")),
    promptText: v.optional(v.string()),
    kind: assetKindValidator,
    description: v.optional(v.string()),
    tagIds: v.array(v.id("tags")),
    tagNames: v.array(v.string()),
    folderId: v.optional(v.id("folders")),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
  }),
  handler: async (ctx, args) => {
    assertCurationAdmin(args.actorUserId, args.adminSecret);

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }

    const ownerUserId = asset.ownerUserId?.trim() || args.actorUserId.trim();
    const nextPillar = hasOwn(args, "pillar")
      ? normalizeOptionalString(args.pillar)
      : asset.pillar;
    const nextFolderId = hasOwn(args, "folderId")
      ? (args.folderId ?? undefined)
      : asset.folderId;
    await ensureFolderOwnership(ctx, ownerUserId, nextFolderId);

    const nextTagIds = hasOwn(args, "tagNames")
      ? await resolveTagIdsForNames(ctx, args.tagNames ?? [], nextPillar)
      : asset.tagIds;
    if (hasOwn(args, "tagNames")) {
      await replaceAssetTagLinks(ctx, asset, nextTagIds);
    }

    const previousPromptId = asset.promptId;
    let nextPromptId = asset.promptId;
    let nextPromptText: string | undefined;
    const shouldEditPrompt = hasOwn(args, "promptText");
    if (shouldEditPrompt) {
      nextPromptText = normalizeOptionalString(args.promptText);
      if (!nextPromptText) {
        nextPromptId = undefined;
      } else if (asset.promptId) {
        const prompt = await ctx.db.get(asset.promptId);
        if (prompt) {
          const promptPatch = {
            text: nextPromptText,
            tagIds: hasOwn(args, "tagNames") ? nextTagIds : prompt.tagIds,
            folderId: nextFolderId,
            pillar: nextPillar,
            modelName: hasOwn(args, "modelName")
              ? normalizeOptionalString(args.modelName)
              : prompt.modelName,
          };
          await ctx.db.patch(prompt._id, promptPatch);
          if (hasOwn(args, "tagNames")) {
            await replacePromptTagLinks(ctx, prompt, nextTagIds);
          }
          await ctx.scheduler.runAfter(0, reindexPromptAction, {
            promptId: prompt._id,
          });
          nextPromptId = prompt._id;
        } else {
          nextPromptId = undefined;
        }
      }

      if (nextPromptText && !nextPromptId) {
        const createdAt = Date.now();
        nextPromptId = await ctx.db.insert("prompts", {
          ownerUserId,
          text: nextPromptText,
          tagIds: nextTagIds,
          folderId: nextFolderId,
          pillar: nextPillar,
          modelName: hasOwn(args, "modelName")
            ? normalizeOptionalString(args.modelName)
            : asset.modelName,
          createdAt,
        });
        for (const tagId of nextTagIds) {
          await ctx.db.insert("promptTags", {
            promptId: nextPromptId,
            tagId,
            createdAt,
          });
        }
        await bumpTagUsage(ctx, nextTagIds, 1);
        await ctx.scheduler.runAfter(0, reindexPromptAction, {
          promptId: nextPromptId,
        });
      }
    } else if (asset.promptId) {
      const prompt = await ctx.db.get(asset.promptId);
      nextPromptText = prompt?.text;
    }

    await ctx.db.patch(args.assetId, {
      tagIds: nextTagIds,
      folderId: nextFolderId,
      promptId: nextPromptId,
      kind: hasOwn(args, "kind") ? args.kind : asset.kind,
      description: hasOwn(args, "description")
        ? normalizeOptionalString(args.description)
        : asset.description,
      sourceUrl: hasOwn(args, "sourceUrl")
        ? normalizeOptionalString(args.sourceUrl)
        : asset.sourceUrl,
      fileName: hasOwn(args, "fileName")
        ? normalizeOptionalString(args.fileName)
        : asset.fileName,
      contentType: hasOwn(args, "contentType")
        ? normalizeOptionalString(args.contentType)
        : asset.contentType,
      modelName: hasOwn(args, "modelName")
        ? normalizeOptionalString(args.modelName)
        : asset.modelName,
      pillar: nextPillar,
      generationType: hasOwn(args, "generationType")
        ? (args.generationType ?? undefined)
        : asset.generationType,
      assetRole: hasOwn(args, "assetRole")
        ? (args.assetRole ?? undefined)
        : asset.assetRole,
      ingestSource: hasOwn(args, "ingestSource")
        ? (args.ingestSource ?? undefined)
        : asset.ingestSource,
    });
    if (hasOwn(args, "folderId")) {
      // `asset` still carries the pre-patch folderId, which is exactly the
      // previous primary this helper needs to swap out.
      await setPrimaryAssetFolder(ctx, ownerUserId, asset, nextFolderId);
    }

    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    const promptIdsToSync = Array.from(
      new Set(
        [previousPromptId, nextPromptId].filter(
          (promptId): promptId is Id<"prompts"> => Boolean(promptId),
        ),
      ),
    );
    for (const promptId of promptIdsToSync) {
      await syncPromptAssetPack(ctx, {
        ownerUserId,
        promptId,
      });
    }

    const finalAsset = await ctx.db.get(args.assetId);
    if (!finalAsset) {
      throw new ConvexError("Asset not found after update.");
    }
    const tags = await Promise.all(
      finalAsset.tagIds.map(async (tagId) => await ctx.db.get(tagId)),
    );
    const prompt = finalAsset.promptId
      ? await ctx.db.get(finalAsset.promptId)
      : null;

    return {
      assetId: finalAsset._id,
      promptId: finalAsset.promptId,
      promptText: prompt?.text,
      kind: finalAsset.kind,
      description: finalAsset.description,
      tagIds: finalAsset.tagIds,
      tagNames: tags
        .map((tag) => tag?.name)
        .filter((name): name is string => Boolean(name)),
      folderId: finalAsset.folderId,
      sourceUrl: finalAsset.sourceUrl,
      fileName: finalAsset.fileName,
      contentType: finalAsset.contentType,
      modelName: finalAsset.modelName,
      pillar: finalAsset.pillar,
      generationType: finalAsset.generationType,
      assetRole: finalAsset.assetRole,
      ingestSource: finalAsset.ingestSource,
    };
  },
});

export const getAsset = query({
  args: {
    id: v.id("assets"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(v.null(), assetDocValidator),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.id);
    if (!asset) {
      return null;
    }
    if (args.ownerUserId && !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) {
      return null;
    }
    return asset;
  },
});

export const getGalleryAsset = query({
  args: {
    id: v.id("assets"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(v.null(), galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.id);
    if (!asset) {
      return null;
    }
    if (args.ownerUserId && !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) {
      return null;
    }
    const [hydrated] = await hydrateGalleryAssetResults(ctx, [asset]);
    return hydrated ?? null;
  },
});

export const getAssetIdForIngestKey = internalQuery({
  args: {
    ownerUserId: v.string(),
    ingestKey: v.string(),
  },
  returns: v.union(v.null(), v.id("assets")),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const ingestKey = args.ingestKey.trim();
    if (!ownerUserId || !ingestKey) {
      return null;
    }

    const existing = await ctx.db
      .query("assets")
      .withIndex("by_owner_ingestKey", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("ingestKey", ingestKey),
      )
      .unique();

    return existing?._id ?? null;
  },
});

export const listAssets = query({
  args: {
    ownerUserId: v.string(),
    tagId: v.optional(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    promptId: v.optional(v.id("prompts")),
    limit: v.optional(v.number()),
  },
  returns: v.array(assetDocValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    const limit = Math.min(args.limit ?? 50, 200);
    if (args.promptId) {
      const results = [];
      for (const ownerCandidate of ownerUserIds) {
        const rows = await ctx.db
          .query("assets")
          .withIndex("by_owner_prompt_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("promptId", args.promptId).gte("createdAt", 0),
          )
          .order("desc")
          .take(limit);
        results.push(...rows);
      }
      return dedupeAssetIds(results)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }
    const tagId = args.tagId;
    if (tagId) {
      const links = await ctx.db
        .query("assetTags")
        .withIndex("by_tag_createdAt", (q) =>
          q.eq("tagId", tagId).gte("createdAt", 0),
        )
        .order("desc")
        .take(limit);
      const results = [];
      for (const link of links) {
        const asset = await ctx.db.get(link.assetId);
        if (asset && canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
          results.push(asset);
        }
      }
      return results;
    }
    if (args.folderId) {
      return await collectAssetsForFolder(
        ctx,
        ownerUserIds,
        args.folderId,
        limit,
      );
    }
    const kind = args.kind;
    if (kind) {
      const results = [];
      for (const ownerCandidate of ownerUserIds) {
        const rows = await ctx.db
          .query("assets")
          .withIndex("by_owner_kind_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("kind", kind).gte("createdAt", 0),
          )
          .order("desc")
          .take(limit);
        results.push(...rows);
      }
      return dedupeAssetIds(results)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }

    const results = [];
    for (const ownerCandidate of ownerUserIds) {
      const rows = await ctx.db
        .query("assets")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0))
        .order("desc")
        .take(limit);
      results.push(...rows);
    }

    return dedupeAssetIds(results)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },
});

const buildSearchHaystack = (
  promptText: string | undefined,
  fileName: string | undefined,
  sourceUrl: string | undefined,
) =>
  [promptText, fileName, sourceUrl]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

const galleryAssetFacetsValidator = v.object({
  totalCount: v.number(),
  modelCounts: v.array(v.object({ name: v.string(), count: v.number() })),
});

// A project's browseable asset pool: the union of all its member collections'
// members (projects never hold assets directly). Capped per collection AND in
// total by `limit`; the caller dedupes. `excludeBeats` drops member
// collections filed under the "beats" section — the main gallery renders
// those as stack cards instead, so their members must not double as tiles.
const collectAssetsForProject = async (
  ctx: QueryCtx,
  ownerUserIds: string[],
  projectId: Id<"folders">,
  limit: number,
  excludeBeats = false,
  section?: ProjectSectionFilter,
) => {
  const links = await ctx.db
    .query("projectCollections")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const assets: Doc<"assets">[] = [];
  for (const link of links) {
    // A section tab narrows the pool to that layer. "unsorted" reaches the
    // members that were never filed, which no named tab would otherwise show.
    if (section !== undefined) {
      const linkSection = link.section ?? "unsorted";
      if (linkSection !== section) continue;
    }
    if (excludeBeats && link.section === "beats") continue;
    if (assets.length >= limit) break;
    assets.push(
      ...(await collectAssetsForFolder(
        ctx,
        ownerUserIds,
        link.folderId,
        limit - assets.length,
      )),
    );
  }
  return assets;
};

// Which folders the current view is looking at, as a membership test for the
// starred read. null = unscoped (plain browse), so every starred asset counts.
const resolveScopeFolderIds = async (
  ctx: QueryCtx,
  args: {
    folderId?: Id<"folders">;
    includeDescendants?: boolean;
    projectId?: Id<"folders">;
    projectSection?: ProjectSectionFilter;
    excludeBeatAssets?: boolean;
  },
): Promise<Set<string> | null> => {
  if (args.projectId) {
    const links = await ctx.db
      .query("projectCollections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
      .collect();
    const scoped = new Set<string>();
    for (const link of links) {
      if (
        args.projectSection !== undefined &&
        (link.section ?? "unsorted") !== args.projectSection
      ) {
        continue;
      }
      if (args.excludeBeatAssets && link.section === "beats") continue;
      scoped.add(link.folderId as string);
    }
    return scoped;
  }

  if (args.folderId) {
    const scoped = new Set<string>([args.folderId as string]);
    if (args.includeDescendants) {
      const children = await ctx.db
        .query("folders")
        .withIndex("by_parent", (q) => q.eq("parentFolderId", args.folderId!))
        .collect();
      for (const child of children) {
        scoped.add(child._id as string);
        // Same reason as collectAssetsForFolderTree: a child project's assets
        // sit in its projectCollections members, not in the project folder.
        if (child.kind !== "project") continue;
        const projectLinks = await ctx.db
          .query("projectCollections")
          .withIndex("by_project", (q) => q.eq("projectId", child._id))
          .collect();
        for (const link of projectLinks) scoped.add(link.folderId as string);
      }
    }
    return scoped;
  }

  return null;
};

// Every folder an asset is filed into: the membership links plus the legacy
// primary pointer, which stays mirrored into links but is cheap to include.
const assetFolderIdSet = async (ctx: QueryCtx, asset: Doc<"assets">) => {
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
    .collect();
  const ids = new Set<string>(links.map((link) => link.folderId as string));
  if (asset.folderId) ids.add(asset.folderId as string);
  return ids;
};

// Workflow step media belongs to its workflow, not to the vault at large. The
// Workflows view is its only browse surface, so the grid, collection and
// starred reads drop it — otherwise one workflow upload floods the gallery with
// its own intermediate frames (depth maps, character sheets, poster stills).
// An explicit `assetRole: "workflow_asset"` query still reaches it, which keeps
// the admin tools working; semantic search runs on its own path and is
// deliberately left alone so a step asset is still findable by searching for it.
const WORKFLOW_STEP_ROLE = "workflow_asset" as const;

const isHiddenWorkflowStepAsset = (
  asset: Doc<"assets">,
  requestedAssetRole?: string,
) =>
  asset.assetRole === WORKFLOW_STEP_ROLE &&
  requestedAssetRole !== WORKFLOW_STEP_ROLE;

// ---------------------------------------------------------------------------
// Curated menu-filter predicate (the gallery's filter pills).
//
// `tagIds` is ONE pill's tag set: the asset matches if it carries any of them
// (a pill may name several duplicate tag docs). `tagIdGroups` is the multi-pill
// form — one group per selected pill — and an asset must satisfy EVERY group.
// Locations + Live Action means "locations that are live action". The flat
// union that came before ANDed nothing, so a second pill only ever widened the
// grid and read as the filter being ignored.
//
// `excludeTagIds` / `excludeFolderIds` are the negative side: an asset carrying
// an excluded tag, or filed in an excluded collection, is dropped no matter what
// else matches. Collection membership is read from the assetFolders links only,
// same as every other membership read.
// ---------------------------------------------------------------------------
interface MenuFilterArgs {
  tagIds?: Id<"tags">[];
  tagIdGroups?: Id<"tags">[][];
  excludeTagIds?: Id<"tags">[];
  excludeFolderIds?: Id<"folders">[];
}

interface MenuFilterPredicate {
  groups: Set<Id<"tags">>[];
  excludedTagIds: Set<Id<"tags">> | null;
  excludedAssetIds: Set<Id<"assets">> | null;
}

const collectAllAssetIdsForFolder = async (
  ctx: QueryCtx,
  folderId: Id<"folders">,
) => {
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_folder_createdAt", (q) =>
      q.eq("folderId", folderId).gte("createdAt", 0),
    )
    .collect();
  return links.map((link) => link.assetId);
};

const buildMenuFilterPredicate = async (
  ctx: QueryCtx,
  args: MenuFilterArgs,
): Promise<MenuFilterPredicate | null> => {
  const groups: Set<Id<"tags">>[] = [];
  if (args.tagIds && args.tagIds.length > 0) {
    groups.push(new Set(args.tagIds));
  }
  for (const group of args.tagIdGroups ?? []) {
    if (group.length > 0) groups.push(new Set(group));
  }

  const excludedTagIds =
    args.excludeTagIds && args.excludeTagIds.length > 0
      ? new Set(args.excludeTagIds)
      : null;

  // An exclusion must see the folder's WHOLE membership — a capped read would
  // silently let members past the cap back into the grid.
  let excludedAssetIds: Set<Id<"assets">> | null = null;
  for (const folderId of args.excludeFolderIds ?? []) {
    const memberIds = await collectAllAssetIdsForFolder(ctx, folderId);
    excludedAssetIds ??= new Set<Id<"assets">>();
    for (const assetId of memberIds) {
      excludedAssetIds.add(assetId);
    }
  }

  if (groups.length === 0 && !excludedTagIds && !excludedAssetIds) {
    return null;
  }
  return { groups, excludedTagIds, excludedAssetIds };
};

const matchesMenuFilters = (
  predicate: MenuFilterPredicate | null,
  asset: Doc<"assets">,
) => {
  if (!predicate) return true;
  if (predicate.excludedAssetIds?.has(asset._id)) return false;
  if (
    predicate.excludedTagIds &&
    asset.tagIds.some((tagId) => predicate.excludedTagIds!.has(tagId))
  ) {
    return false;
  }
  return predicate.groups.every((group) =>
    asset.tagIds.some((tagId) => group.has(tagId)),
  );
};

const hasMenuFilterArgs = (args: MenuFilterArgs) =>
  Boolean(
    (args.tagIds && args.tagIds.length > 0) ||
      (args.tagIdGroups && args.tagIdGroups.some((group) => group.length > 0)) ||
      (args.excludeTagIds && args.excludeTagIds.length > 0) ||
      (args.excludeFolderIds && args.excludeFolderIds.length > 0),
  );

// The starred assets in the current view, newest star first.
//
// Read on its own rather than sorted out of the main grid query: browse is
// cursor-paginated 60 at a time, so a starred asset sitting on page 9 would
// otherwise not reach the top of the grid until the user scrolled that far.
// The caller merges these into its asset list before filtering, so search and
// the filter bar still apply to them normally.
export const listStarredAssets = query({
  args: {
    ownerUserId: v.string(),
    folderId: v.optional(v.id("folders")),
    includeDescendants: v.optional(v.boolean()),
    projectId: v.optional(v.id("folders")),
    projectSection: v.optional(projectSectionFilterValidator),
    excludeBeatAssets: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const limit = Math.min(args.limit ?? 120, 400);
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    const starred = dedupeAssetIds(
      (
        await Promise.all(
          ownerUserIds.map(async (ownerCandidate) =>
            await ctx.db
              .query("assets")
              .withIndex("by_owner_starredAt", (q) =>
                q.eq("ownerUserId", ownerCandidate).gt("starredAt", 0),
              )
              .order("desc")
              .take(limit),
          ),
        )
      ).flat(),
    )
      .filter((asset) => !isHiddenWorkflowStepAsset(asset))
      .sort((a, b) => (b.starredAt ?? 0) - (a.starredAt ?? 0));

    const scopeFolderIds = await resolveScopeFolderIds(ctx, args);
    if (scopeFolderIds === null) {
      return await hydrateGalleryAssetResults(ctx, starred.slice(0, limit));
    }
    if (scopeFolderIds.size === 0) return [];

    const inScope: Doc<"assets">[] = [];
    for (const asset of starred) {
      if (inScope.length >= limit) break;
      const folderIds = await assetFolderIdSet(ctx, asset);
      for (const folderId of folderIds) {
        if (scopeFolderIds.has(folderId)) {
          inScope.push(asset);
          break;
        }
      }
    }
    return await hydrateGalleryAssetResults(ctx, inScope);
  },
});

export const listGalleryAssets = query({
  args: {
    ownerUserId: v.string(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    // One group per selected filter pill — the asset must match every group
    // (AND across pills, OR inside one). See buildMenuFilterPredicate.
    tagIdGroups: v.optional(v.array(v.array(v.id("tags")))),
    excludeTagIds: v.optional(v.array(v.id("tags"))),
    excludeFolderIds: v.optional(v.array(v.id("folders"))),
    folderId: v.optional(v.id("folders")),
    // With folderId: also include the folder's sub-collections, so browsing a
    // world shows its Characters / Locations / Scenes too, not just the loose
    // assets sitting on the parent folder.
    includeDescendants: v.optional(v.boolean()),
    // Browse a project's whole pool (union of its member collections).
    projectId: v.optional(v.id("folders")),
    // With projectId: skip members of "beats"-section collections — the
    // caller shows those as beat stack cards, not flat tiles.
    excludeBeatAssets: v.optional(v.boolean()),
    // With projectId: narrow to one section tab (Beats / Characters /
    // Locations / Stills / Unsorted). Omit for the "All" tab.
    projectSection: v.optional(projectSectionFilterValidator),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    assetRole: assetRoleValidator,
    onlyLiked: v.optional(v.boolean()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const onlyLiked = args.onlyLiked === true;
    const limit = Math.min(args.limit ?? 100, 2000);
    const scopedToSet = args.projectId ?? args.folderId;
    const hasPostQueryFilters = Boolean(
      hasMenuFilterArgs(args) ||
        (scopedToSet && (args.pillar || args.modelName || args.assetRole || args.kind)) ||
        (args.modelName && (args.pillar || scopedToSet || args.assetRole || args.kind)) ||
        (args.pillar && (scopedToSet || args.modelName || args.kind)) ||
        (args.assetRole && (scopedToSet || args.modelName || args.kind)) ||
        // `onlyLiked` post-filters whenever it isn't served by its own index
        // (i.e. when combined with a set query), so widen the take then too.
        (onlyLiked && scopedToSet) ||
        args.search,
    );
    const queryTake = hasPostQueryFilters ? Math.min(limit * 4, 2000) : limit;
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const menuFilters = await buildMenuFilterPredicate(ctx, args);
    const search = args.search?.trim().toLowerCase();
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const assetRole = args.assetRole;
    const kind = args.kind;
    const ownerScopedAssets = args.projectId
      ? await collectAssetsForProject(
          ctx,
          ownerUserIds,
          args.projectId,
          queryTake,
          args.excludeBeatAssets === true,
          args.projectSection,
        )
      : args.folderId
      ? args.includeDescendants
        ? await collectAssetsForFolderTree(
            ctx,
            ownerUserIds,
            args.folderId,
            queryTake,
          )
        : await collectAssetsForFolder(ctx, ownerUserIds, args.folderId, queryTake)
      : (
          await Promise.all(
            ownerUserIds.map(async (ownerCandidate) => {
              if (onlyLiked) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_isLiked_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("isLiked", true).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (modelNameFilter) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_modelName_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("modelName", modelNameFilter).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (pillar && assetRole) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_pillar_assetRole_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("pillar", pillar).eq("assetRole", assetRole).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (pillar) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_pillar_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("pillar", pillar).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (assetRole) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_assetRole_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("assetRole", assetRole).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (kind) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_kind_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("kind", kind).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              return await ctx.db
                .query("assets")
                .withIndex("by_owner_createdAt", (q) =>
                  q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
                )
                .order("desc")
                .take(queryTake);
            }),
          )
        ).flat();

    ownerScopedAssets.sort((a, b) => b.createdAt - a.createdAt);
    const seenAssetIds = new Set<Id<"assets">>();
    const assets = ownerScopedAssets.filter((asset) => {
      if (seenAssetIds.has(asset._id)) {
        return false;
      }
      seenAssetIds.add(asset._id);
      return true;
    });
    const filteredAssets = assets.filter((asset) => {
      if (isHiddenWorkflowStepAsset(asset, assetRole)) {
        return false;
      }
      if (!matchesMenuFilters(menuFilters, asset)) {
        return false;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        return false;
      }
      if (assetRole && asset.assetRole !== assetRole) {
        return false;
      }
      if (kind && asset.kind !== kind) {
        return false;
      }
      if (onlyLiked && asset.isLiked !== true) {
        return false;
      }
      return true;
    });

    if (filteredAssets.length === 0) {
      return [];
    }

    let selectedAssets = filteredAssets;
    let promptTextById: Map<Id<"prompts">, string>;
    if (search) {
      const promptIds = dedupeIds(
        filteredAssets
          .map((asset) => asset.promptId)
          .filter((promptId): promptId is Id<"prompts"> => Boolean(promptId)),
      );
      const promptEntries = await Promise.all(
        promptIds.map(async (promptId) => {
          const prompt = await ctx.db.get(promptId);
          return [promptId, prompt?.text] as const;
        }),
      );
      promptTextById = new Map(
        promptEntries.filter((entry): entry is [Id<"prompts">, string] => Boolean(entry[1])),
      );
      selectedAssets = filteredAssets.filter((asset) => {
        const promptText = asset.promptId
          ? promptTextById.get(asset.promptId)
          : undefined;
        return buildSearchHaystack(promptText, asset.fileName, asset.sourceUrl)
          .includes(search);
      });
    } else {
      selectedAssets = filteredAssets.slice(0, limit);
      promptTextById = new Map();
    }

    selectedAssets = selectedAssets.slice(0, limit);
    if (selectedAssets.length === 0) {
      return [];
    }

    return await hydrateGalleryAssetResults(ctx, selectedAssets);
  },
});

export const galleryAssetFacets = query({
  args: {
    ownerUserId: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: galleryAssetFacetsValidator,
  handler: async (ctx, args) => {
    let assets: Doc<"assets">[];
    if (args.ownerUserId) {
      const ownerUserId = args.ownerUserId.trim();
      if (!ownerUserId) {
        throw new ConvexError("ownerUserId is required when provided.");
      }
      const rows: Doc<"assets">[] = [];
      for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
        const rowsForOwner = await ctx.db
          .query("assets")
          .withIndex("by_owner_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
          )
          .collect();
        rows.push(...rowsForOwner);
      }
      // Match the grid: workflow step media is not browsable here, so counting
      // it would advertise model pills that filter down to nothing.
      assets = dedupeAssetIds(rows).filter(
        (asset) => !isHiddenWorkflowStepAsset(asset),
      );
    } else if (args.isPublic) {
      assets = await ctx.db
        .query("assets")
        .withIndex("by_isPublic_createdAt", (q) => q.eq("isPublic", true))
        .collect();
    } else {
      assets = await ctx.db.query("assets").collect();
    }

    const modelCountsByKey = new Map<string, { name: string; count: number }>();
    for (const asset of assets) {
      const trimmed = asset.modelName?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const existing = modelCountsByKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        modelCountsByKey.set(key, { name: trimmed, count: 1 });
      }
    }

    return {
      totalCount: assets.length,
      modelCounts: Array.from(modelCountsByKey.values()).sort((left, right) => {
        const countDiff = right.count - left.count;
        if (countDiff !== 0) return countDiff;
        return left.name.localeCompare(right.name);
      }),
    };
  },
});

export const listPublicGalleryAssets = query({
  args: {
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    tagIdGroups: v.optional(v.array(v.array(v.id("tags")))),
    excludeTagIds: v.optional(v.array(v.id("tags"))),
    excludeFolderIds: v.optional(v.array(v.id("folders"))),
    folderId: v.optional(v.id("folders")),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    assetRole: assetRoleValidator,
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 2000);
    const queryTake = Math.min(limit * 3, 2000);
    const menuFilters = await buildMenuFilterPredicate(ctx, args);
    const search = args.search?.trim().toLowerCase();
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const assetRole = args.assetRole;
    const kind = args.kind;

    const baseAssets = await (pillar
      ? ctx.db
          .query("assets")
          .withIndex("by_isPublic_pillar_createdAt", (q) =>
            q.eq("isPublic", true).eq("pillar", pillar).gte("createdAt", 0),
          )
      : kind
        ? ctx.db
            .query("assets")
            .withIndex("by_isPublic_kind_createdAt", (q) =>
              q.eq("isPublic", true).eq("kind", kind).gte("createdAt", 0),
            )
        : ctx.db
            .query("assets")
            .withIndex("by_isPublic_createdAt", (q) =>
              q.eq("isPublic", true).gte("createdAt", 0),
            )
    )
      .order("desc")
      .take(queryTake);

    const folderAssetIds = args.folderId
      ? await collectAssetIdsForFolder(ctx, args.folderId, queryTake)
      : null;

    const filteredAssets = baseAssets.filter((asset) => {
      if (!matchesMenuFilters(menuFilters, asset)) {
        return false;
      }
      if (folderAssetIds && !folderAssetIds.has(asset._id)) {
        return false;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        return false;
      }
      if (assetRole && asset.assetRole !== assetRole) {
        return false;
      }
      return true;
    });

    if (filteredAssets.length === 0) {
      return [];
    }

    let selectedAssets = filteredAssets;
    let promptTextById: Map<Id<"prompts">, string>;
    if (search) {
      const promptIds = dedupeIds(
        filteredAssets
          .map((asset) => asset.promptId)
          .filter((promptId): promptId is Id<"prompts"> => Boolean(promptId)),
      );
      const promptEntries = await Promise.all(
        promptIds.map(async (promptId) => {
          const prompt = await ctx.db.get(promptId);
          return [promptId, prompt?.text] as const;
        }),
      );
      promptTextById = new Map(
        promptEntries.filter((entry): entry is [Id<"prompts">, string] => Boolean(entry[1])),
      );
      selectedAssets = filteredAssets.filter((asset) => {
        const promptText = asset.promptId
          ? promptTextById.get(asset.promptId)
          : undefined;
        return buildSearchHaystack(promptText, asset.fileName, asset.sourceUrl)
          .includes(search);
      });
    } else {
      selectedAssets = filteredAssets.slice(0, limit);
      promptTextById = new Map();
    }

    selectedAssets = selectedAssets.slice(0, limit);
    if (selectedAssets.length === 0) {
      return [];
    }

    return await hydrateGalleryAssetResults(ctx, selectedAssets);
  },
});

// ---------------------------------------------------------------------------
// Cursor-paginated gallery feeds (infinite scroll).
//
// These replace the capped listGalleryAssets/listPublicGalleryAssets calls for
// the default browse path: instead of one query re-reading the whole gallery
// on every load AND every reactive re-run, the client subscribes to small
// pages and only the page containing a change re-reads. Multi-value filters
// post-filter the page (pages may come back short — the client keeps calling
// loadMore while its scroll frontier is exposed, so short pages self-heal).
//
// The mine-scope cursor wraps Convex's cursor with an owner-candidate index
// (legacy ids may exist under both "123" and "telegram:123"): candidates are
// paginated sequentially and the wrapper hops to the next candidate when one
// is exhausted. splitCursor/pageStatus are intentionally not returned — the
// wrapped cursor would corrupt a client-driven split.
// ---------------------------------------------------------------------------

const galleryPageValidator = v.object({
  page: v.array(galleryAssetResultValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

type WrappedCursor = { o: number; c: string | null };

const parseWrappedCursor = (raw: string | null): WrappedCursor => {
  if (!raw) return { o: 0, c: null };
  try {
    const parsed = JSON.parse(raw) as Partial<WrappedCursor>;
    return {
      o: typeof parsed.o === "number" && parsed.o >= 0 ? parsed.o : 0,
      c: typeof parsed.c === "string" ? parsed.c : null,
    };
  } catch {
    return { o: 0, c: null };
  }
};

export const listGalleryAssetsPage = query({
  args: {
    ownerUserId: v.string(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    assetRole: assetRoleValidator,
    onlyLiked: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: galleryPageValidator,
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const candidates = resolveUserIdCandidates(ownerUserId);
    const cursor = parseWrappedCursor(args.paginationOpts.cursor);
    const ownerIndex = Math.min(cursor.o, candidates.length - 1);
    const ownerCandidate = candidates[ownerIndex];

    const onlyLiked = args.onlyLiked === true;
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const assetRole = args.assetRole;
    const kind = args.kind;
    const tagFilter =
      args.tagIds && args.tagIds.length > 0 ? new Set(args.tagIds) : null;

    // Same index priority as listGalleryAssets; leftover filters post-filter.
    const indexed = onlyLiked
      ? ctx.db
          .query("assets")
          .withIndex("by_owner_isLiked_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("isLiked", true).gte("createdAt", 0),
          )
      : modelNameFilter
        ? ctx.db
            .query("assets")
            .withIndex("by_owner_modelName_createdAt", (q) =>
              q.eq("ownerUserId", ownerCandidate).eq("modelName", modelNameFilter).gte("createdAt", 0),
            )
        : pillar && assetRole
          ? ctx.db
              .query("assets")
              .withIndex("by_owner_pillar_assetRole_createdAt", (q) =>
                q.eq("ownerUserId", ownerCandidate).eq("pillar", pillar).eq("assetRole", assetRole).gte("createdAt", 0),
              )
          : pillar
            ? ctx.db
                .query("assets")
                .withIndex("by_owner_pillar_createdAt", (q) =>
                  q.eq("ownerUserId", ownerCandidate).eq("pillar", pillar).gte("createdAt", 0),
                )
            : assetRole
              ? ctx.db
                  .query("assets")
                  .withIndex("by_owner_assetRole_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("assetRole", assetRole).gte("createdAt", 0),
                  )
              : kind
                ? ctx.db
                    .query("assets")
                    .withIndex("by_owner_kind_createdAt", (q) =>
                      q.eq("ownerUserId", ownerCandidate).eq("kind", kind).gte("createdAt", 0),
                    )
                : ctx.db
                    .query("assets")
                    .withIndex("by_owner_createdAt", (q) =>
                      q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
                    );

    const result = await indexed.order("desc").paginate({
      numItems: args.paginationOpts.numItems,
      cursor: cursor.c,
    });

    const filtered = result.page.filter((asset) => {
      if (isHiddenWorkflowStepAsset(asset, assetRole)) {
        return false;
      }
      if (tagFilter && !asset.tagIds.some((tagId) => tagFilter.has(tagId))) {
        return false;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        return false;
      }
      if (assetRole && asset.assetRole !== assetRole) {
        return false;
      }
      if (kind && asset.kind !== kind) {
        return false;
      }
      if (onlyLiked && asset.isLiked !== true) {
        return false;
      }
      return true;
    });

    const isLastCandidate = ownerIndex >= candidates.length - 1;
    return {
      page: await hydrateGalleryAssetResults(ctx, filtered),
      isDone: result.isDone && isLastCandidate,
      continueCursor:
        result.isDone && !isLastCandidate
          ? JSON.stringify({ o: ownerIndex + 1, c: null })
          : JSON.stringify({ o: ownerIndex, c: result.continueCursor }),
    };
  },
});

// Cursor-paginated members of ONE collection, newest link first ("recently
// added" order). Backs the folder-scoped infinite scroll exactly like
// listGalleryAssetsPage backs the unfiltered grid: the wrapper cursor walks
// the owner id candidates, the inner cursor pages the assetFolders links
// index — so a collection of any size streams fully, no 600 cap. Membership
// upkeep mirrors the legacy assets.folderId alias into links, so links alone
// are the complete member set.
export const listFolderAssetsPage = query({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    paginationOpts: paginationOptsValidator,
  },
  returns: galleryPageValidator,
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const candidates = resolveUserIdCandidates(ownerUserId);
    const cursor = parseWrappedCursor(args.paginationOpts.cursor);
    const ownerIndex = Math.min(cursor.o, candidates.length - 1);
    const ownerCandidate = candidates[ownerIndex];

    const result = await ctx.db
      .query("assetFolders")
      .withIndex("by_owner_folder_createdAt", (q) =>
        q
          .eq("ownerUserId", ownerCandidate)
          .eq("folderId", args.folderId)
          .gte("createdAt", 0),
      )
      .order("desc")
      .paginate({
        numItems: args.paginationOpts.numItems,
        cursor: cursor.c,
      });

    const assets = (
      await Promise.all(
        result.page.map(async (link) => await ctx.db.get(link.assetId)),
      )
    ).filter(
      (asset): asset is Doc<"assets"> =>
        asset !== null && !isHiddenWorkflowStepAsset(asset),
    );

    const isLastCandidate = ownerIndex >= candidates.length - 1;
    return {
      page: await hydrateGalleryAssetResults(ctx, assets),
      isDone: result.isDone && isLastCandidate,
      continueCursor:
        result.isDone && !isLastCandidate
          ? JSON.stringify({ o: ownerIndex + 1, c: null })
          : JSON.stringify({ o: ownerIndex, c: result.continueCursor }),
    };
  },
});

export const listPublicGalleryAssetsPage = query({
  args: {
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    modelName: v.optional(v.string()),
    // Restrict the public page to one collection's membership — what a
    // collection-kind menu filter pill selects.
    folderId: v.optional(v.id("folders")),
    pillar: pillarValidator,
    assetRole: assetRoleValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: galleryPageValidator,
  handler: async (ctx, args) => {
    const tagFilter =
      args.tagIds && args.tagIds.length > 0 ? new Set(args.tagIds) : null;
    // Membership is a links-only read; the ids gate the page below so the
    // pagination cursor still walks the isPublic index.
    const folderFilter = args.folderId
      ? new Set(
          (
            await ctx.db
              .query("assetFolders")
              .withIndex("by_folder_createdAt", (q) =>
                q.eq("folderId", args.folderId as Id<"folders">),
              )
              .collect()
          ).map((link) => link.assetId as string),
        )
      : null;
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const assetRole = args.assetRole;
    const kind = args.kind;

    const indexed = pillar
      ? ctx.db
          .query("assets")
          .withIndex("by_isPublic_pillar_createdAt", (q) =>
            q.eq("isPublic", true).eq("pillar", pillar).gte("createdAt", 0),
          )
      : kind
        ? ctx.db
            .query("assets")
            .withIndex("by_isPublic_kind_createdAt", (q) =>
              q.eq("isPublic", true).eq("kind", kind).gte("createdAt", 0),
            )
        : ctx.db
            .query("assets")
            .withIndex("by_isPublic_createdAt", (q) =>
              q.eq("isPublic", true).gte("createdAt", 0),
            );

    const result = await indexed.order("desc").paginate(args.paginationOpts);

    const filtered = result.page.filter((asset) => {
      if (tagFilter && !asset.tagIds.some((tagId) => tagFilter.has(tagId))) {
        return false;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        return false;
      }
      if (assetRole && asset.assetRole !== assetRole) {
        return false;
      }
      if (kind && asset.kind !== kind) {
        return false;
      }
      if (folderFilter && !folderFilter.has(asset._id)) {
        return false;
      }
      return true;
    });

    return {
      page: await hydrateGalleryAssetResults(ctx, filtered),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const setAssetCuration = mutation({
  args: {
    assetId: v.id("assets"),
    actorUserId: v.string(),
    isPublic: v.boolean(),
    isFeatured: v.optional(v.boolean()),
    adminSecret: v.string(),
  },
  returns: v.object({
    assetId: v.id("assets"),
    isPublic: v.boolean(),
    isFeatured: v.boolean(),
    curatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const expectedSecret = process.env.CURATION_ADMIN_SECRET;
    if (!expectedSecret || args.adminSecret !== expectedSecret) {
      throw new ConvexError("Unauthorized curator request.");
    }

    const actorUserId = args.actorUserId.trim();
    if (!actorUserId) {
      throw new ConvexError("actorUserId is required.");
    }

    const allowedUserIds = getCuratorUserIdsFromEnv();
    if (allowedUserIds.length === 0) {
      throw new ConvexError("Curator user list is not configured.");
    }

    const canCurate = canActorAccessByUserId(actorUserId, allowedUserIds);
    if (!canCurate) {
      throw new ConvexError("Forbidden curator.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }

    const curatedAt = Date.now();
    const nextIsPublic = args.isPublic;
    const nextIsFeatured =
      args.isFeatured !== undefined ? args.isFeatured && nextIsPublic : Boolean(asset.isFeatured && nextIsPublic);

    await ctx.db.patch(args.assetId, {
      isPublic: nextIsPublic,
      isFeatured: nextIsFeatured,
      curatedByUserId: actorUserId,
      curatedAt,
    });
    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    return {
      assetId: args.assetId,
      isPublic: nextIsPublic,
      isFeatured: nextIsFeatured,
      curatedAt,
    };
  },
});

const BULK_CURATION_MAX = 200;

export const bulkSetAssetCuration = mutation({
  args: {
    assetIds: v.array(v.id("assets")),
    actorUserId: v.string(),
    isPublic: v.boolean(),
    isFeatured: v.optional(v.boolean()),
    adminSecret: v.string(),
  },
  returns: v.object({
    updatedCount: v.number(),
    skippedCount: v.number(),
    isPublic: v.boolean(),
    curatedAt: v.number(),
    updatedAssetIds: v.array(v.id("assets")),
    missingAssetIds: v.array(v.id("assets")),
  }),
  handler: async (ctx, args) => {
    const expectedSecret = process.env.CURATION_ADMIN_SECRET;
    if (!expectedSecret || args.adminSecret !== expectedSecret) {
      throw new ConvexError("Unauthorized curator request.");
    }

    const actorUserId = args.actorUserId.trim();
    if (!actorUserId) {
      throw new ConvexError("actorUserId is required.");
    }

    const allowedUserIds = getCuratorUserIdsFromEnv();
    if (allowedUserIds.length === 0) {
      throw new ConvexError("Curator user list is not configured.");
    }

    const canCurate = canActorAccessByUserId(actorUserId, allowedUserIds);
    if (!canCurate) {
      throw new ConvexError("Forbidden curator.");
    }

    if (args.assetIds.length === 0) {
      throw new ConvexError("At least one assetId is required.");
    }
    if (args.assetIds.length > BULK_CURATION_MAX) {
      throw new ConvexError(
        `Bulk curation is limited to ${BULK_CURATION_MAX} assets per request.`,
      );
    }

    const uniqueAssetIds = Array.from(new Set(args.assetIds));
    const curatedAt = Date.now();
    const nextIsPublic = args.isPublic;
    const updatedAssetIds: Id<"assets">[] = [];
    const missingAssetIds: Id<"assets">[] = [];

    for (const assetId of uniqueAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset) {
        missingAssetIds.push(assetId);
        continue;
      }

      const nextIsFeatured =
        args.isFeatured !== undefined
          ? args.isFeatured && nextIsPublic
          : Boolean(asset.isFeatured && nextIsPublic);

      await ctx.db.patch(assetId, {
        isPublic: nextIsPublic,
        isFeatured: nextIsFeatured,
        curatedByUserId: actorUserId,
        curatedAt,
      });
      await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId });
      updatedAssetIds.push(assetId);
    }

    return {
      updatedCount: updatedAssetIds.length,
      skippedCount: missingAssetIds.length,
      isPublic: nextIsPublic,
      curatedAt,
      updatedAssetIds,
      missingAssetIds,
    };
  },
});

// Folder-level curation: publish or unpublish a whole collection's members in
// one call, so the owner never has to bulk-select assets by hand. Membership
// comes from assetFolders links plus the legacy folderId alias; assets already
// in the target state are skipped (no writes, no reindex churn).
const FOLDER_CURATION_MAX = 2000;

export const bulkSetFolderCuration = mutation({
  args: {
    folderId: v.id("folders"),
    actorUserId: v.string(),
    isPublic: v.boolean(),
    adminSecret: v.string(),
  },
  returns: v.object({
    folderId: v.id("folders"),
    memberCount: v.number(),
    updatedCount: v.number(),
    isPublic: v.boolean(),
    curatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const expectedSecret = process.env.CURATION_ADMIN_SECRET;
    if (!expectedSecret || args.adminSecret !== expectedSecret) {
      throw new ConvexError("Unauthorized curator request.");
    }

    const actorUserId = args.actorUserId.trim();
    if (!actorUserId) {
      throw new ConvexError("actorUserId is required.");
    }

    const allowedUserIds = getCuratorUserIdsFromEnv();
    if (allowedUserIds.length === 0) {
      throw new ConvexError("Curator user list is not configured.");
    }
    if (!canActorAccessByUserId(actorUserId, allowedUserIds)) {
      throw new ConvexError("Forbidden curator.");
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }

    const memberAssetIds = await collectAssetIdsForFolder(
      ctx,
      args.folderId,
      FOLDER_CURATION_MAX,
    );

    const curatedAt = Date.now();
    const nextIsPublic = args.isPublic;
    let updatedCount = 0;

    for (const assetId of memberAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || Boolean(asset.isPublic) === nextIsPublic) {
        continue;
      }
      await ctx.db.patch(assetId, {
        isPublic: nextIsPublic,
        isFeatured: Boolean(asset.isFeatured && nextIsPublic),
        curatedByUserId: actorUserId,
        curatedAt,
      });
      await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId });
      updatedCount += 1;
    }

    return {
      folderId: args.folderId,
      memberCount: memberAssetIds.size,
      updatedCount,
      isPublic: nextIsPublic,
      curatedAt,
    };
  },
});

// "Already saved?" check for the extension: exact ingestKey hits plus bounded
// ingestKey prefix scans. Midjourney serves one generation under several CDN
// URL variants (grid webp vs full-res jpeg), so exact keys alone would miss
// earlier saves of the same image. Prefixes are length-gated so a short or
// empty prefix can never turn into a broad index scan.
const INGEST_MATCH_MAX_ENTRIES = 16;
const INGEST_MATCH_MIN_PREFIX_LENGTH = 30;

export const checkAssetIngestMatches = query({
  args: {
    ownerUserId: v.string(),
    keys: v.array(v.string()),
    prefixes: v.array(v.string()),
  },
  returns: v.object({
    matchedKeys: v.array(v.string()),
    matchedPrefixes: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const keys = [
      ...new Set(args.keys.map((key) => key.trim()).filter(Boolean)),
    ].slice(0, INGEST_MATCH_MAX_ENTRIES);
    const prefixes = [
      ...new Set(
        args.prefixes
          .map((prefix) => prefix.trim())
          .filter((prefix) => prefix.length >= INGEST_MATCH_MIN_PREFIX_LENGTH),
      ),
    ].slice(0, INGEST_MATCH_MAX_ENTRIES);

    const ownerCandidates = resolveUserIdCandidates(ownerUserId);
    const matchedKeys: string[] = [];
    const matchedPrefixes: string[] = [];

    for (const key of keys) {
      for (const ownerCandidate of ownerCandidates) {
        const existing = await ctx.db
          .query("assets")
          .withIndex("by_owner_ingestKey", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("ingestKey", key),
          )
          .first();
        if (existing) {
          matchedKeys.push(key);
          break;
        }
      }
    }

    for (const prefix of prefixes) {
      for (const ownerCandidate of ownerCandidates) {
        const existing = await ctx.db
          .query("assets")
          .withIndex("by_owner_ingestKey", (q) =>
            q
              .eq("ownerUserId", ownerCandidate)
              .gte("ingestKey", prefix)
              .lt("ingestKey", `${prefix}\uffff`),
          )
          .first();
        if (existing) {
          matchedPrefixes.push(prefix);
          break;
        }
      }
    }

    return { matchedKeys, matchedPrefixes };
  },
});

// Idempotently attach tags (by name) to an asset. Creates missing tags via
// the same normalized/canonical matching as tags.getOrCreateTags, unions with
// the asset's existing tagIds, and keeps assetTags links + usageCount in sync.
// Deliberately does NOT schedule a semantic reindex — bulk tagging would fan
// out hundreds of embedding jobs; the periodic backfill picks the change up.
export const addAssetTags = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    tagNames: v.array(v.string()),
  },
  returns: v.object({
    assetId: v.id("assets"),
    addedTagNames: v.array(v.string()),
    tagIds: v.array(v.id("tags")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    // Per-name indexed lookups — this used to full-scan the tags table on
    // every single-asset tag add.
    const resolvedByCanonical = new Map<string, Id<"tags">>();
    const resolvedTagIds: Id<"tags">[] = [];
    const addedTagNames: string[] = [];
    for (const raw of args.tagNames) {
      const normalized = normalizeTagName(raw);
      if (!normalized) continue;
      const canonical = canonicalTagKey(raw);
      const cached = canonical ? resolvedByCanonical.get(canonical) : undefined;
      if (cached) {
        resolvedTagIds.push(cached);
        continue;
      }
      const existing =
        (await ctx.db
          .query("tags")
          .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
          .first()) ??
        (canonical
          ? await ctx.db
              .query("tags")
              .withIndex("by_canonicalKey", (q) =>
                q.eq("canonicalKey", canonical),
              )
              .first()
          : null);
      if (existing) {
        resolvedTagIds.push(existing._id);
        if (canonical) resolvedByCanonical.set(canonical, existing._id);
        continue;
      }
      const tagId = await ctx.db.insert("tags", {
        name: raw.trim(),
        normalized,
        canonicalKey: canonicalTagKey(raw),
        usageCount: 0,
      });
      resolvedTagIds.push(tagId);
      if (canonical) resolvedByCanonical.set(canonical, tagId);
    }

    const existingSet = new Set(asset.tagIds);
    const newTagIds = dedupeIds(resolvedTagIds).filter(
      (tagId) => !existingSet.has(tagId),
    );
    if (newTagIds.length === 0) {
      return { assetId: asset._id, addedTagNames: [], tagIds: asset.tagIds };
    }

    const nextTagIds = [...asset.tagIds, ...newTagIds];
    await ctx.db.patch(asset._id, { tagIds: nextTagIds });
    await bumpTagUsage(ctx, newTagIds, 1);
    for (const tagId of newTagIds) {
      await ctx.db.insert("assetTags", {
        assetId: asset._id,
        tagId,
        createdAt: asset.createdAt,
      });
      const tag = await ctx.db.get(tagId);
      if (tag) addedTagNames.push(tag.name);
    }

    return { assetId: asset._id, addedTagNames, tagIds: nextTagIds };
  },
});

// Rename an asset. The name is a short user-given handle, referenced as
// @name when composing beats. Empty clears it.
export const renameAsset = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    name: v.string(),
  },
  returns: v.object({
    assetId: v.id("assets"),
    name: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }
    const name = args.name.trim().slice(0, 80) || undefined;
    await ctx.db.patch(asset._id, { name });
    return { assetId: asset._id, name };
  },
});

// Manual ordering for the project workspace: move an asset to the top or
// bottom of its views. Timestamps keep repeated moves monotonic (the latest
// "top" wins) without reading siblings.
export const setAssetPriority = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    // "clear" undoes a move — back to the natural (newest-first) slot.
    position: v.union(
      v.literal("top"),
      v.literal("bottom"),
      v.literal("clear"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }
    await ctx.db.patch(asset._id, {
      orderPriority:
        args.position === "clear"
          ? undefined
          : args.position === "top"
            ? Date.now()
            : -Date.now(),
    });
    return null;
  },
});

// Pin/unpin an asset in the project workspace. Pinned assets float above
// everything (latest pin first) and carry a pin marker.
export const setAssetPinned = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }
    await ctx.db.patch(asset._id, {
      pinnedAt: args.pinned ? Date.now() : undefined,
    });
    return null;
  },
});

// Owner-side twin of beatBoard.getBoardAssetDownload: resolve one asset's
// bytes URL for the /api/assets/[assetId]/download proxy (R2's public domain
// has no CORS headers, so downloads stream same-origin with an attachment
// header). The route validates the session before calling this.
export const getAssetDownload = query({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
  },
  returns: v.union(
    v.null(),
    v.object({
      url: v.string(),
      fileName: v.optional(v.string()),
      contentType: v.optional(v.string()),
      kind: v.union(v.literal("image"), v.literal("video")),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) return null;
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      return null;
    }
    const url = await resolveAssetUrl(ctx, asset);
    if (!url) return null;
    return {
      url,
      fileName: asset.fileName,
      contentType: asset.contentType,
      kind: asset.kind,
    };
  },
});

// Reference options for the @ selector: every named asset PLUS the newest
// assets across the gallery, so ANY asset can be pulled into a beat — named
// ones by @name, the rest by file name. The client filters as the user types.
export const listAssetOptions = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(
    v.object({
      assetId: v.id("assets"),
      name: v.optional(v.string()),
      fileName: v.optional(v.string()),
      kind: v.union(v.literal("image"), v.literal("video")),
      thumbUrl: v.optional(v.string()),
      tagNames: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const rows: Doc<"assets">[] = [];
    for (const ownerCandidate of ownerUserIds) {
      const named = await ctx.db
        .query("assets")
        .withIndex("by_owner_name", (q) =>
          q.eq("ownerUserId", ownerCandidate).gt("name", ""),
        )
        .take(300);
      const recent = await ctx.db
        .query("assets")
        .withIndex("by_owner_createdAt", (q) =>
          q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
        )
        .order("desc")
        .take(600);
      rows.push(...named, ...recent);
    }
    const seen = new Set<string>();
    const deduped = rows.filter((asset) => {
      if (seen.has(asset._id)) return false;
      seen.add(asset._id);
      return true;
    });

    const tagNameById = new Map<Id<"tags">, string | null>();
    const resolveTagNames = async (tagIds: Id<"tags">[]) => {
      const names: string[] = [];
      for (const tagId of tagIds) {
        if (!tagNameById.has(tagId)) {
          const tag = await ctx.db.get(tagId);
          tagNameById.set(tagId, tag?.name ?? null);
        }
        const name = tagNameById.get(tagId);
        if (name) names.push(name);
      }
      return names;
    };

    return await Promise.all(
      deduped.map(async (asset) => ({
        assetId: asset._id,
        name: asset.name,
        fileName: asset.fileName,
        kind: asset.kind,
        thumbUrl: (await resolveAssetThumbUrl(ctx, asset)) ?? undefined,
        tagNames: await resolveTagNames(asset.tagIds),
      })),
    );
  },
});

// The global tag used to mark an asset "approved" in the review workflow.
export const APPROVED_TAG_NAME = "approved";

// Shared engine for boolean-flag tags (approved, character, location, …):
// add or remove one tag on an asset with an owner check, keeping tagIds +
// assetTags links + usageCount in sync. Idempotent in both beats.
const setTagPresenceOnAsset = async (
  ctx: MutationCtx,
  args: { ownerUserId: string; assetId: Id<"assets"> },
  tagName: string,
  present: boolean,
): Promise<Id<"assets">> => {
  const ownerUserId = args.ownerUserId.trim();
  if (!ownerUserId) {
    throw new ConvexError("ownerUserId is required.");
  }
  const asset = await ctx.db.get(args.assetId);
  if (!asset) {
    throw new ConvexError("Asset not found.");
  }
  if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
    throw new ConvexError("Asset does not belong to this user.");
  }

  const normalized = normalizeTagName(tagName);
  if (!normalized) {
    throw new ConvexError("Tag name is required.");
  }
  let tag = await ctx.db
    .query("tags")
    .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
    .unique();

  if (present) {
    if (!tag) {
      const tagId = await ctx.db.insert("tags", {
        name: tagName,
        normalized,
        canonicalKey: canonicalTagKey(tagName),
        usageCount: 0,
      });
      tag = await ctx.db.get(tagId);
    }
    if (!tag) {
      throw new ConvexError(`Failed to resolve tag "${tagName}".`);
    }
    if (asset.tagIds.includes(tag._id)) {
      return asset._id;
    }
    await ctx.db.patch(asset._id, { tagIds: [...asset.tagIds, tag._id] });
    await bumpTagUsage(ctx, [tag._id], 1);
    const existingLink = await ctx.db
      .query("assetTags")
      .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
      .filter((q) => q.eq(q.field("tagId"), tag!._id))
      .unique();
    if (!existingLink) {
      await ctx.db.insert("assetTags", {
        assetId: asset._id,
        tagId: tag._id,
        createdAt: asset.createdAt,
      });
    }
    return asset._id;
  }

  // Remove: strip the tag from the asset if present.
  if (!tag || !asset.tagIds.includes(tag._id)) {
    return asset._id;
  }
  await ctx.db.patch(asset._id, {
    tagIds: asset.tagIds.filter((id) => id !== tag!._id),
  });
  await bumpTagUsage(ctx, [tag._id], -1);
  const links = await ctx.db
    .query("assetTags")
    .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
    .filter((q) => q.eq(q.field("tagId"), tag!._id))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  return asset._id;
};

// Toggle any global tag on an asset with the same boolean-flag ergonomics.
// Powers the project workspace role chips (character / location), where a
// tag IS the asset's role inside a beat.
export const setAssetTagState = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    tagName: v.string(),
    present: v.boolean(),
  },
  returns: v.object({
    assetId: v.id("assets"),
    present: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const assetId = await setTagPresenceOnAsset(
      ctx,
      args,
      args.tagName.trim(),
      args.present,
    );
    return { assetId, present: args.present };
  },
});

// Bulk twin of setAssetTagState: stamp one statics tag (character / location /
// scene) across a whole selection. Backs the gallery's bulk toolbar — before
// this the only way to type a piece was one asset at a time in the detail
// panel. Idempotent per asset; missing ids are skipped, not fatal.
const BULK_TAG_MAX = 500;

export const bulkSetAssetTagState = mutation({
  args: {
    ownerUserId: v.string(),
    assetIds: v.array(v.id("assets")),
    tagName: v.string(),
    present: v.boolean(),
  },
  returns: v.object({
    updatedCount: v.number(),
    skippedCount: v.number(),
    tagName: v.string(),
    present: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const tagName = args.tagName.trim();
    if (!tagName) {
      throw new ConvexError("Tag name is required.");
    }
    const uniqueAssetIds = Array.from(new Set(args.assetIds));
    if (uniqueAssetIds.length === 0) {
      throw new ConvexError("At least one assetId is required.");
    }
    if (uniqueAssetIds.length > BULK_TAG_MAX) {
      throw new ConvexError(
        `Bulk tagging is limited to ${BULK_TAG_MAX} assets per request.`,
      );
    }

    let updatedCount = 0;
    let skippedCount = 0;
    for (const assetId of uniqueAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset) {
        skippedCount += 1;
        continue;
      }
      await setTagPresenceOnAsset(
        ctx,
        { ownerUserId: args.ownerUserId, assetId },
        tagName,
        args.present,
      );
      updatedCount += 1;
    }

    return { updatedCount, skippedCount, tagName, present: args.present };
  },
});

// Minimal projection of every owned asset for the style-classification
// backfill (scripts/classify-animation-live-action.ts): media URLs to fetch
// bytes from plus current tag names for idempotent skip checks.
export const listAssetsForStyleClassification = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(
    v.object({
      assetId: v.id("assets"),
      kind: v.union(v.literal("image"), v.literal("video")),
      contentType: v.optional(v.string()),
      url: v.optional(v.string()),
      thumbUrl: v.optional(v.string()),
      tagNames: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const rows = [];
    for (const ownerCandidate of ownerUserIds) {
      const rowsForOwner = await ctx.db
        .query("assets")
        .withIndex("by_owner_createdAt", (q) =>
          q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
        )
        .collect();
      rows.push(...rowsForOwner);
    }
    const assets = dedupeAssetIds(rows);

    const tagIds = dedupeIds(assets.flatMap((asset) => asset.tagIds));
    const tagNameById = new Map<Id<"tags">, string>();
    for (const tagId of tagIds) {
      const tag = await ctx.db.get(tagId);
      if (tag) tagNameById.set(tagId, tag.name);
    }

    return await Promise.all(
      assets.map(async (asset) => ({
        assetId: asset._id,
        kind: asset.kind,
        contentType: asset.contentType,
        url: (await resolveAssetUrl(ctx, asset)) ?? undefined,
        thumbUrl: (await resolveAssetThumbUrl(ctx, asset)) ?? undefined,
        tagNames: asset.tagIds
          .map((tagId) => tagNameById.get(tagId))
          .filter((name): name is string => Boolean(name)),
      })),
    );
  },
});

export const folderAssetCounts = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(v.object({ folderId: v.id("folders"), count: v.number() })),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    // Membership source of truth is the assetFolders join; the count is the
    // denormalized folders.memberCount, kept exact by recountFolderMembers.
    // (This query used to re-collect every folder's assets + links on every
    // asset write — O(folders × members) per subscription re-run.)
    const folders = [];
    for (const ownerCandidate of ownerUserIds) {
      const foldersForOwner = await ctx.db
        .query("folders")
        .withIndex("by_owner_normalizedName", (q) =>
          q.eq("ownerUserId", ownerCandidate).gte("normalizedName", ""),
        )
        .collect();
      folders.push(...foldersForOwner);
    }

    const seenFolderIds = new Set<Id<"folders">>();
    const results: Array<{ folderId: Id<"folders">; count: number }> = [];
    for (const folder of folders) {
      if (seenFolderIds.has(folder._id)) continue;
      seenFolderIds.add(folder._id);
      results.push({ folderId: folder._id, count: folder.memberCount ?? 0 });
    }

    return results;
  },
});

// Collections exposed on the Public gallery scope — derived, not allowlisted:
// any plain collection with at least one public member appears, counted over
// its public assets only. Publishing assets (individually or via
// bulkSetFolderCuration) is the single lever that makes a collection
// public-facing; unpublishing the last asset drops it again.
export const listPublicCollections = query({
  args: {},
  returns: v.array(
    v.object({
      folderId: v.id("folders"),
      label: v.string(),
      count: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const publicAssets = await ctx.db
      .query("assets")
      .withIndex("by_isPublic_createdAt", (q) =>
        q.eq("isPublic", true).gte("createdAt", 0),
      )
      .collect();

    const countByFolder = new Map<Id<"folders">, number>();
    for (const asset of publicAssets) {
      const links = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .collect();
      const folderIds = new Set(links.map((link) => link.folderId));
      if (asset.folderId) folderIds.add(asset.folderId);
      for (const folderId of folderIds) {
        countByFolder.set(folderId, (countByFolder.get(folderId) ?? 0) + 1);
      }
    }

    const results: Array<{ folderId: Id<"folders">; label: string; count: number }> = [];
    for (const [folderId, count] of countByFolder) {
      const folder = await ctx.db.get(folderId);
      if (!folder || folder.kind !== undefined) continue;
      results.push({ folderId, label: folder.name, count });
    }

    return results.sort((a, b) => a.label.localeCompare(b.label));
  },
});

export const replaceAssetThumbnail = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    newThumbStorageId: v.optional(v.id("_storage")),
    newThumbR2Key: v.optional(v.string()),
    newThumbR2Bucket: v.optional(v.string()),
    thumbWidth: v.optional(v.number()),
    thumbHeight: v.optional(v.number()),
    thumbSize: v.optional(v.number()),
  },
  returns: v.id("assets"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    // Delete old thumbnail from storage
    if (asset.thumbStorageId && asset.thumbStorageId !== args.newThumbStorageId) {
      await ctx.storage.delete(asset.thumbStorageId);
    }
    if (asset.thumbR2Key && asset.thumbR2Key !== args.newThumbR2Key) {
      await r2.deleteObject(ctx, asset.thumbR2Key);
    }

    await ctx.db.patch(args.assetId, {
      thumbStorageId: args.newThumbStorageId,
      thumbR2Key: args.newThumbR2Key,
      thumbR2Bucket: args.newThumbR2Bucket,
      thumbWidth: args.thumbWidth,
      thumbHeight: args.thumbHeight,
      thumbSize: args.thumbSize,
    });

    return args.assetId;
  },
});

export const replaceAssetMedia = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    storageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
    r2Key: v.optional(v.string()),
    r2Bucket: v.optional(v.string()),
    thumbR2Key: v.optional(v.string()),
    thumbR2Bucket: v.optional(v.string()),
    kind: v.union(v.literal("image"), v.literal("video")),
    contentType: v.optional(v.string()),
    fileName: v.optional(v.string()),
    size: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    thumbSize: v.optional(v.number()),
    thumbWidth: v.optional(v.number()),
    thumbHeight: v.optional(v.number()),
  },
  returns: v.id("assets"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    if (asset.storageId && asset.storageId !== args.storageId) {
      await ctx.storage.delete(asset.storageId);
    }
    if (asset.thumbStorageId && asset.thumbStorageId !== args.thumbStorageId) {
      await ctx.storage.delete(asset.thumbStorageId);
    }
    if (asset.r2Key && asset.r2Key !== args.r2Key) {
      await r2.deleteObject(ctx, asset.r2Key);
    }
    if (asset.thumbR2Key && asset.thumbR2Key !== args.thumbR2Key) {
      await r2.deleteObject(ctx, asset.thumbR2Key);
    }

    await ctx.db.patch(args.assetId, {
      storageId: args.storageId,
      thumbStorageId: args.thumbStorageId,
      r2Key: args.r2Key,
      r2Bucket: args.r2Bucket,
      thumbR2Key: args.thumbR2Key,
      thumbR2Bucket: args.thumbR2Bucket,
      kind: args.kind,
      contentType: args.contentType,
      fileName: args.fileName,
      size: args.size,
      width: args.width,
      height: args.height,
      thumbSize: args.thumbSize,
      thumbWidth: args.thumbWidth,
      thumbHeight: args.thumbHeight,
    });

    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    return args.assetId;
  },
});

// The one true asset delete: row, tag links + usage, folder/beat links,
// lineage, blobs (Convex + R2), pack reconciliation, semantic reindex.
// EVERY delete path (single, bulk, wipe) must go through this — the bulk
// paths used to re-implement it and silently skipped tag usage, pack
// reconciliation and the semantic cleanup.
const deleteAssetCascade = async (ctx: MutationCtx, asset: Doc<"assets">) => {
  const links = await ctx.db
    .query("assetTags")
    .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }

  // Collection/beat memberships die with the asset — orphaned links would
  // ghost-occupy folder slots and inflate counts.
  const folderLinks = await ctx.db
    .query("assetFolders")
    .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
    .collect();
  for (const link of folderLinks) {
    await ctx.db.delete(link._id);
  }
  await recountFolderMembers(
    ctx,
    folderLinks.map((link) => link.folderId),
  );

  const storageIds = dedupeIds(
    [asset.storageId, asset.thumbStorageId].filter(
      (id): id is Id<"_storage"> => Boolean(id),
    ),
  );
  for (const storageId of storageIds) {
    await ctx.storage.delete(storageId);
  }

  if (asset.r2Key) {
    await r2.deleteObject(ctx, asset.r2Key);
  }
  if (asset.thumbR2Key) {
    await r2.deleteObject(ctx, asset.thumbR2Key);
  }

  const lineageRows = [
    ...(await ctx.db
      .query("generationLineage")
      .withIndex("by_targetAsset", (q) => q.eq("targetAssetId", asset._id))
      .collect()),
    ...(await ctx.db
      .query("generationLineage")
      .withIndex("by_sourceAsset", (q) => q.eq("sourceAssetId", asset._id))
      .collect()),
  ];
  for (const row of lineageRows) {
    await ctx.db.delete(row._id);
  }

  const packId = asset.assetPackId;
  await ctx.db.delete(asset._id);
  if (packId) {
    await reconcileAssetPackMembership(ctx, packId);
  }
  await bumpTagUsage(ctx, dedupeIds(asset.tagIds), -1);
  await ctx.scheduler.runAfter(0, reindexAssetAction, {
    assetId: asset._id,
  });
};

// Internal-only delete. Performs the actual storage + DB cleanup. Callers
// (public `deleteAsset`, ingest rollback paths, etc.) are responsible for
// authorization before invoking this.
export const internalDeleteAsset = internalMutation({
  args: {
    id: v.id("assets"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.id);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    await deleteAssetCascade(ctx, asset);
    return null;
  },
});

const internalDeleteAssetMutation = makeFunctionReference<"mutation">(
  "assets:internalDeleteAsset",
);

// Public admin-only delete. Requires CURATION_ADMIN_SECRET + actor in
// CURATION_ADMIN_USER_IDS / KB_OWNER_USER_ID. Regular logged-in users cannot
// delete assets — only the configured admins/owner of the deployment can.
export const deleteAsset = mutation({
  args: {
    id: v.id("assets"),
    actorUserId: v.string(),
    adminSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertCurationAdmin(args.actorUserId, args.adminSecret);
    await ctx.runMutation(internalDeleteAssetMutation, { id: args.id });
    return null;
  },
});

// One-off GC: assetFolders rows whose asset no longer exists (from deletes
// that predate the folder-link cleanup in internalDeleteAsset). Run via CLI:
//   bunx convex run assets:cleanupOrphanedAssetFolderLinks '{"dryRun":true}'
export const cleanupOrphanedAssetFolderLinks = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    scanned: v.number(),
    orphaned: v.number(),
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const links = await ctx.db.query("assetFolders").collect();
    let orphaned = 0;
    let deleted = 0;
    const affectedFolderIds: Id<"folders">[] = [];
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (!asset) {
        orphaned += 1;
        if (args.dryRun !== true) {
          await ctx.db.delete(link._id);
          affectedFolderIds.push(link.folderId);
          deleted += 1;
        }
      }
    }
    await recountFolderMembers(ctx, affectedFolderIds);
    return { scanned: links.length, orphaned, deleted };
  },
});

export const bulkDeleteAssets = internalMutation({
  args: { ids: v.array(v.id("assets")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for (const id of args.ids) {
      const asset = await ctx.db.get(id);
      if (!asset) {
        continue;
      }
      await deleteAssetCascade(ctx, asset);
      count++;
    }
    return count;
  },
});

export const wipeAllAssets = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    assetsDeleted: v.number(),
    assetTagLinksDeleted: v.number(),
    storageObjectsDeleted: v.number(),
    tagsAdjusted: v.number(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const assets = await ctx.db.query("assets").collect();
    const assetTagLinks = await ctx.db.query("assetTags").collect();

    const tagIds = new Set<Id<"tags">>();
    const uniqueStorageIds = new Set<Id<"_storage">>();
    const uniqueR2Keys = new Set<string>();
    for (const asset of assets) {
      for (const tagId of asset.tagIds) tagIds.add(tagId);
      if (asset.storageId) uniqueStorageIds.add(asset.storageId);
      if (asset.thumbStorageId) uniqueStorageIds.add(asset.thumbStorageId);
      if (asset.r2Key) uniqueR2Keys.add(asset.r2Key);
      if (asset.thumbR2Key) uniqueR2Keys.add(asset.thumbR2Key);
    }

    if (!dryRun) {
      for (const asset of assets) {
        await deleteAssetCascade(ctx, asset);
      }
    }

    return {
      dryRun,
      assetsDeleted: assets.length,
      assetTagLinksDeleted: assetTagLinks.length,
      storageObjectsDeleted: uniqueStorageIds.size + uniqueR2Keys.size,
      tagsAdjusted: tagIds.size,
    };
  },
});

// ── Featured shelf (owner admin) ────────────────────────────────────────────
// The pieces that lead the public home, as the owner manages them. The public
// reel is capped, so this deliberately returns MORE than that cap and marks
// which rows actually make the cut — a piece you featured but can't see out
// front should be visible here, not silently missing.
const FEATURED_SHELF_LIMIT = 60;

export const listFeaturedAssets = query({
  args: { ownerUserId: v.string(), publicCap: v.optional(v.number()) },
  returns: v.array(
    v.object({
      asset: galleryAssetResultValidator,
      /** Position in the owner's order, 1-based. */
      position: v.number(),
      /** False once past the public reel's cap — featured but not on the home. */
      onPublicHome: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const cap = args.publicCap ?? 12;

    const rows: Doc<"assets">[] = [];
    for (const ownerCandidate of ownerUserIds) {
      rows.push(
        ...(await ctx.db
          .query("assets")
          .withIndex("by_owner_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
          )
          .order("desc")
          .take(1200)),
      );
    }
    const seen = new Set<string>();
    const featured = rows.filter((asset) => {
      if (asset.isFeatured !== true || seen.has(asset._id)) return false;
      seen.add(asset._id);
      return true;
    });

    // Must match convex/showcase.ts's reel sort exactly, or this panel would
    // show a different order than the page it manages.
    featured.sort((a, b) => {
      const ao = a.orderPriority ?? Number.NEGATIVE_INFINITY;
      const bo = b.orderPriority ?? Number.NEGATIVE_INFINITY;
      if (ao !== bo) return bo - ao;
      const av = a.kind === "video" ? 0 : 1;
      const bv = b.kind === "video" ? 0 : 1;
      if (av !== bv) return av - bv;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });

    const capped = featured.slice(0, FEATURED_SHELF_LIMIT);
    const hydrated = await hydrateGalleryAssetResults(ctx, capped);
    return hydrated.map((asset, index) => ({
      asset,
      position: index + 1,
      onPublicHome: index < cap,
    }));
  },
});

/**
 * Write an explicit order across the featured shelf.
 *
 * Takes the full ordered list rather than a swap: dense descending weights mean
 * the result can't drift, and one call covers a drag, a nudge, or a reversal.
 * Weights are large and spaced so a later `setAssetPriority("top")` from the
 * project workspace (which writes +Date.now()) still lands above the shelf
 * instead of landing in the middle of it.
 */
export const reorderFeaturedAssets = mutation({
  args: { ownerUserId: v.string(), assetIds: v.array(v.id("assets")) },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (args.assetIds.length === 0) return { updated: 0 };

    let updated = 0;
    const top = args.assetIds.length;
    for (const [index, assetId] of args.assetIds.entries()) {
      const asset = await ctx.db.get(assetId);
      if (!asset) continue;
      if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
        throw new ConvexError("Asset does not belong to this user.");
      }
      // Higher = earlier, matching the schema and both consumers.
      const next = top - index;
      if (asset.orderPriority !== next) {
        await ctx.db.patch(assetId, { orderPriority: next });
        updated += 1;
      }
    }
    return { updated };
  },
});

/**
 * Set just the description. `updateAssetMetadata` also exists, but it takes a
 * full `tagIds` array and replaces membership wholesale — using it to edit one
 * caption means echoing every tag back correctly or silently wiping them. This
 * touches one column.
 */
export const setAssetDescription = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    description: v.string(),
  },
  returns: v.object({
    assetId: v.id("assets"),
    description: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }
    // Empty clears it rather than storing "".
    const description = args.description.trim() || undefined;
    await ctx.db.patch(args.assetId, { description });
    return { assetId: args.assetId, description };
  },
});

/**
 * Replace an asset's tags by NAME, owner-auth.
 *
 * The admin route (`adminUpdateAsset`) can already do this, but it sits behind
 * the curation secret and takes a full metadata patch — too heavy for editing
 * tags on an open asset. Names rather than ids so the caller never has to
 * create a tag first; unknown names are created, like ingest does.
 */
export const setAssetTags = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    tagNames: v.array(v.string()),
  },
  returns: v.object({ assetId: v.id("assets"), tagIds: v.array(v.id("tags")) }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    const tagIds = await resolveTagIdsForNames(ctx, args.tagNames, asset.pillar);
    await replaceAssetTagLinks(ctx, asset, tagIds);
    await ctx.db.patch(args.assetId, { tagIds });
    // Tags feed the embedding text, so the vector goes stale without this.
    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });
    return { assetId: args.assetId, tagIds };
  },
});

// ── Content-hash backfill support ───────────────────────────────────────────
// Rows created before contentHash existed carry no digest, so a re-upload of
// older work would sail past the duplicate check. These two feed the
// "use node" action that hashes them (convex/contentHash.ts).

export const listAssetsMissingContentHash = internalQuery({
  args: {
    ownerUserId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        assetId: v.id("assets"),
        r2Key: v.optional(v.string()),
        storageId: v.optional(v.id("_storage")),
      }),
    ),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const page = await ctx.db
      .query("assets")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).gte("createdAt", 0),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: args.batchSize ?? 25,
      });
    return {
      rows: page.page
        .filter((asset) => !asset.contentHash)
        .map((asset) => ({
          assetId: asset._id,
          r2Key: asset.r2Key,
          storageId: asset.storageId,
        })),
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const setAssetContentHash = internalMutation({
  args: { assetId: v.id("assets"), contentHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    // Only ever fills a gap — never overwrites a digest ingest computed.
    if (asset && !asset.contentHash) {
      await ctx.db.patch(args.assetId, { contentHash: args.contentHash });
    }
    return null;
  },
});

// ── Duplicate sweep ─────────────────────────────────────────────────────────
// Ingest now blocks new duplicates by content hash, but rows created before
// that landed can still be twins. These power contentHash:dedupeExistingAssets.

export const listAssetHashPage = internalQuery({
  args: {
    ownerUserId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        assetId: v.id("assets"),
        contentHash: v.string(),
      }),
    ),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const page = await ctx.db
      .query("assets")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).gte("createdAt", 0),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: args.batchSize ?? 200,
      });
    return {
      rows: page.page
        .filter((asset) => Boolean(asset.contentHash))
        .map((asset) => ({
          assetId: asset._id,
          contentHash: asset.contentHash!,
        })),
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Fold a group of byte-identical assets into one.
 *
 * The group is passed whole and the keeper is chosen HERE, with the docs in
 * hand: a piece that is published, featured or starred wins (public surfaces
 * and the featured reel point at it by id), then the one filed in the most
 * places, then the one carrying a prompt, then the oldest — the original save.
 *
 * Everything the losers carried moves across first: collection and project
 * memberships, tags, the owner's flags, and every inbound reference (folder /
 * pack / workflow covers, lineage, board likes). Only then are they deleted, so
 * no id is ever left dangling.
 */
export const mergeDuplicateAssets = internalMutation({
  args: {
    ownerUserId: v.string(),
    assetIds: v.array(v.id("assets")),
  },
  returns: v.object({
    keeperId: v.union(v.id("assets"), v.null()),
    removed: v.array(v.id("assets")),
    foldersGained: v.number(),
    tagsGained: v.number(),
    referencesRepointed: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const docs = [];
    for (const assetId of dedupeIds(args.assetIds)) {
      const asset = await ctx.db.get(assetId);
      if (!asset) continue;
      if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
        throw new ConvexError("Asset does not belong to this user.");
      }
      docs.push(asset);
    }
    if (docs.length < 2) {
      return {
        keeperId: docs[0]?._id ?? null,
        removed: [],
        foldersGained: 0,
        tagsGained: 0,
        referencesRepointed: 0,
      };
    }

    const folderIdsFor = async (asset: Doc<"assets">) => {
      const links = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .collect();
      return links;
    };

    const scored = [];
    for (const asset of docs) {
      const links = await folderIdsFor(asset);
      scored.push({
        asset,
        links,
        curated:
          asset.isPublic === true ||
          asset.isFeatured === true ||
          Boolean(asset.starredAt),
      });
    }
    scored.sort((a, b) => {
      if (a.curated !== b.curated) return a.curated ? -1 : 1;
      if (a.links.length !== b.links.length) return b.links.length - a.links.length;
      const ap = a.asset.promptId ? 1 : 0;
      const bp = b.asset.promptId ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (a.asset.createdAt ?? 0) - (b.asset.createdAt ?? 0);
    });

    const keeper = scored[0];
    const losers = scored.slice(1);
    const keeperFolderIds = new Set(keeper.links.map((link) => link.folderId));

    let foldersGained = 0;
    let tagsGained = 0;
    let referencesRepointed = 0;
    const patch: Partial<Doc<"assets">> = {};
    const nextTagIds = new Set<string>(keeper.asset.tagIds);

    for (const loser of losers) {
      // Memberships the keeper doesn't have yet.
      for (const link of loser.links) {
        if (keeperFolderIds.has(link.folderId)) continue;
        keeperFolderIds.add(link.folderId);
        await ctx.db.insert("assetFolders", {
          ownerUserId: link.ownerUserId,
          assetId: keeper.asset._id,
          folderId: link.folderId,
          createdAt: link.createdAt,
        });
        foldersGained += 1;
      }
      if (!keeper.asset.folderId && loser.asset.folderId) {
        patch.folderId = loser.asset.folderId;
      }

      // Tags.
      for (const tagId of loser.asset.tagIds) {
        if (nextTagIds.has(tagId)) continue;
        nextTagIds.add(tagId);
        await ctx.db.insert("assetTags", {
          assetId: keeper.asset._id,
          tagId,
          createdAt: keeper.asset.createdAt ?? Date.now(),
        });
        await bumpTagUsage(ctx, [tagId], 1);
        tagsGained += 1;
      }

      // Owner intent is a union: a flag set on ANY copy survives.
      if (loser.asset.isPublic && !keeper.asset.isPublic) patch.isPublic = true;
      if (loser.asset.isFeatured && !keeper.asset.isFeatured) {
        patch.isFeatured = true;
      }
      if (loser.asset.isLiked && !keeper.asset.isLiked) patch.isLiked = true;
      if (loser.asset.starredAt && !keeper.asset.starredAt) {
        patch.starredAt = loser.asset.starredAt;
        if (loser.asset.starNote && !keeper.asset.starNote) {
          patch.starNote = loser.asset.starNote;
        }
      }
      if (!keeper.asset.description && loser.asset.description) {
        patch.description = loser.asset.description;
      }
      if (!keeper.asset.promptId && loser.asset.promptId) {
        patch.promptId = loser.asset.promptId;
      }
      if (!keeper.asset.sourceUrl && loser.asset.sourceUrl) {
        patch.sourceUrl = loser.asset.sourceUrl;
      }

      // Inbound references — repoint before the row disappears.
      const coverFolders = await ctx.db
        .query("folders")
        .filter((q) => q.eq(q.field("coverAssetId"), loser.asset._id))
        .collect();
      for (const folder of coverFolders) {
        await ctx.db.patch(folder._id, { coverAssetId: keeper.asset._id });
        referencesRepointed += 1;
      }
      const coverPacks = await ctx.db
        .query("assetPacks")
        .filter((q) => q.eq(q.field("coverAssetId"), loser.asset._id))
        .collect();
      for (const pack of coverPacks) {
        await ctx.db.patch(pack._id, { coverAssetId: keeper.asset._id });
        referencesRepointed += 1;
      }
      const coverWorkflows = await ctx.db
        .query("workflows")
        .filter((q) => q.eq(q.field("coverAssetId"), loser.asset._id))
        .collect();
      for (const workflow of coverWorkflows) {
        await ctx.db.patch(workflow._id, { coverAssetId: keeper.asset._id });
        referencesRepointed += 1;
      }
      const likes = await ctx.db
        .query("boardReactions")
        .filter((q) => q.eq(q.field("assetId"), loser.asset._id))
        .collect();
      for (const like of likes) {
        await ctx.db.patch(like._id, { assetId: keeper.asset._id });
        referencesRepointed += 1;
      }

      // The cascade deletes the loser's R2 objects. Identical bytes normally
      // mean separate uploads and separate keys, but if a key IS shared with
      // the keeper, clear it first or the survivor loses its media.
      const sharedKey = loser.asset.r2Key && loser.asset.r2Key === keeper.asset.r2Key;
      const sharedThumb =
        loser.asset.thumbR2Key && loser.asset.thumbR2Key === keeper.asset.thumbR2Key;
      if (sharedKey || sharedThumb) {
        await ctx.db.patch(loser.asset._id, {
          r2Key: sharedKey ? undefined : loser.asset.r2Key,
          thumbR2Key: sharedThumb ? undefined : loser.asset.thumbR2Key,
        });
      }
      const refreshed = await ctx.db.get(loser.asset._id);
      if (refreshed) {
        await deleteAssetCascade(ctx, refreshed);
      }
    }

    if (nextTagIds.size !== keeper.asset.tagIds.length) {
      patch.tagIds = Array.from(nextTagIds) as Id<"tags">[];
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(keeper.asset._id, patch);
    }
    await recountFolderMembers(ctx, Array.from(keeperFolderIds) as Id<"folders">[]);
    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: keeper.asset._id,
    });

    return {
      keeperId: keeper.asset._id,
      removed: losers.map((loser) => loser.asset._id),
      foldersGained,
      tagsGained,
      referencesRepointed,
    };
  },
});
