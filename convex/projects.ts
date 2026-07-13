import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { collectAssetsForFolder } from "./assets";
import {
  galleryAssetResultValidator,
  hydrateGalleryAssetResults,
} from "./galleryAssetResults";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  canActorAccessOwnerUserId,
  resolveUserIdCandidates,
} from "./authz";
import {
  optionalProjectSectionValidator,
  projectSectionValidator,
} from "./validators";

// Preview thumbnails on a project stack card.
const STACK_PREVIEW_LIMIT = 4;
// Per-member-collection asset cap when hydrating a project for review.
const PROJECT_COLLECTION_ASSET_LIMIT = 200;

const projectPreviewValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  thumbWidth: v.optional(v.number()),
  thumbHeight: v.optional(v.number()),
});

const projectSummaryValidator = v.object({
  _id: v.id("folders"),
  name: v.string(),
  brief: v.optional(v.string()),
  collectionCount: v.number(),
  assetCount: v.number(),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  previewAssets: v.array(projectPreviewValidator),
  // Member directions, so the sidebar can offer them as drop targets.
  collections: v.array(
    v.object({
      folderId: v.id("folders"),
      name: v.string(),
      section: optionalProjectSectionValidator,
    }),
  ),
});

export type ProjectSection = "characters" | "locations" | "beats";

export type ProjectCollectionLink = {
  folderId: Id<"folders">;
  section?: ProjectSection;
  beatCharacterFolderIds: Id<"folders">[];
  beatLocationFolderIds: Id<"folders">[];
};

// Merge the legacy single-id beat pairing into the arrays shape (dedup,
// legacy id first when both exist).
const mergeBeatLinks = (
  legacy: Id<"folders"> | undefined,
  ids: Id<"folders">[] | undefined,
): Id<"folders">[] => {
  const merged = [...(legacy ? [legacy] : []), ...(ids ?? [])];
  return [...new Set(merged)];
};

// Collect the member-collection links of a project, via the projectCollections
// join, across the owner's id candidates. Deduped, order preserved by insert
// time (createdAt asc) so the review view has a stable collection order.
export const collectProjectCollectionLinks = async (
  ctx: QueryCtx | MutationCtx,
  ownerUserIds: string[],
  projectId: Id<"folders">,
): Promise<ProjectCollectionLink[]> => {
  const rows = await ctx.db
    .query("projectCollections")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const owned = rows.filter((row) => ownerUserIds.includes(row.ownerUserId));
  owned.sort((a, b) => a.createdAt - b.createdAt);
  const seen = new Set<string>();
  const links: ProjectCollectionLink[] = [];
  for (const row of owned) {
    if (seen.has(row.folderId)) continue;
    seen.add(row.folderId);
    links.push({
      folderId: row.folderId,
      section: row.section,
      beatCharacterFolderIds: mergeBeatLinks(
        row.beatCharacterFolderId,
        row.beatCharacterFolderIds,
      ),
      beatLocationFolderIds: mergeBeatLinks(
        row.beatLocationFolderId,
        row.beatLocationFolderIds,
      ),
    });
  }
  return links;
};

export const collectProjectCollectionIds = async (
  ctx: QueryCtx | MutationCtx,
  ownerUserIds: string[],
  projectId: Id<"folders">,
): Promise<Id<"folders">[]> => {
  const links = await collectProjectCollectionLinks(
    ctx,
    ownerUserIds,
    projectId,
  );
  return links.map((link) => link.folderId);
};

const collectOwnerProjectFolders = async (
  ctx: QueryCtx,
  ownerUserIds: string[],
): Promise<Doc<"folders">[]> => {
  const folders: Doc<"folders">[] = [];
  for (const ownerCandidate of ownerUserIds) {
    const foldersForOwner = await ctx.db
      .query("folders")
      .withIndex("by_owner_normalizedName", (q) =>
        q.eq("ownerUserId", ownerCandidate).gte("normalizedName", ""),
      )
      .collect();
    folders.push(...foldersForOwner);
  }
  const seen = new Set<Id<"folders">>();
  return folders.filter((folder) => {
    if (folder.kind !== "project" || seen.has(folder._id)) return false;
    seen.add(folder._id);
    return true;
  });
};

export const listProjects = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(projectSummaryValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const projects = await collectOwnerProjectFolders(ctx, ownerUserIds);

    const results = await Promise.all(
      projects.map(async (folder) => {
        const collectionLinks = await collectProjectCollectionLinks(
          ctx,
          ownerUserIds,
          folder._id,
        );
        const collectionIds = collectionLinks.map((link) => link.folderId);
        const memberCollections = await Promise.all(
          collectionLinks.map(async ({ folderId, section }) => {
            const collectionFolder = await ctx.db.get(folderId);
            return {
              folderId,
              name: collectionFolder?.name ?? "Untitled collection",
              section,
            };
          }),
        );

        // Union assets across member collections (deduped) for the stack
        // count + preview thumbs.
        const seenAssets = new Set<string>();
        const memberAssets: Doc<"assets">[] = [];
        for (const folderId of collectionIds) {
          const members = await collectAssetsForFolder(
            ctx,
            ownerUserIds,
            folderId,
            PROJECT_COLLECTION_ASSET_LIMIT,
          );
          for (const asset of members) {
            if (seenAssets.has(asset._id)) continue;
            seenAssets.add(asset._id);
            memberAssets.push(asset);
          }
        }

        const previews = await Promise.all(
          memberAssets.slice(0, STACK_PREVIEW_LIMIT).map(async (asset) => {
            const [url, thumbUrl] = await Promise.all([
              resolveAssetUrl(ctx, asset),
              resolveAssetThumbUrl(ctx, asset),
            ]);
            return {
              assetId: asset._id,
              kind: asset.kind,
              contentType: asset.contentType,
              url: url ?? undefined,
              thumbUrl: thumbUrl ?? undefined,
              width: asset.width,
              height: asset.height,
              thumbWidth: asset.thumbWidth,
              thumbHeight: asset.thumbHeight,
            };
          }),
        );

        return {
          _id: folder._id,
          name: folder.name,
          brief: folder.description,
          collectionCount: collectionIds.length,
          assetCount: memberAssets.length,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          previewAssets: previews,
          collections: memberCollections,
        };
      }),
    );

    return results.sort(
      (left, right) =>
        (right.updatedAt ?? right.createdAt ?? 0) -
        (left.updatedAt ?? left.createdAt ?? 0),
    );
  },
});

export const getProject = query({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
  },
  returns: v.union(
    v.null(),
    v.object({
      project: v.object({
        _id: v.id("folders"),
        name: v.string(),
        brief: v.optional(v.string()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
      }),
      collections: v.array(
        v.object({
          folderId: v.id("folders"),
          name: v.string(),
          description: v.optional(v.string()),
          section: optionalProjectSectionValidator,
          coverAssetId: v.optional(v.id("assets")),
          pinnedAt: v.optional(v.number()),
          beatCharacterFolderIds: v.array(v.id("folders")),
          beatLocationFolderIds: v.array(v.id("folders")),
          count: v.number(),
          assets: v.array(galleryAssetResultValidator),
        }),
      ),
      // Authless viewer likes from the shared board, per asset.
      assetLikes: v.array(
        v.object({
          assetId: v.id("assets"),
          count: v.number(),
          names: v.array(v.string()),
        }),
      ),
      // …and per direction (beat cards on the board take whole-beat likes).
      collectionLikes: v.array(
        v.object({
          folderId: v.id("folders"),
          count: v.number(),
          names: v.array(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const folder = await ctx.db.get(args.projectId);
    if (!folder || folder.kind !== "project") {
      return null;
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Project does not belong to this user.");
    }

    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const collectionLinks = await collectProjectCollectionLinks(
      ctx,
      ownerUserIds,
      folder._id,
    );

    const collections = await Promise.all(
      collectionLinks.map(
        async ({
          folderId,
          section,
          beatCharacterFolderIds,
          beatLocationFolderIds,
        }) => {
          const collectionFolder = await ctx.db.get(folderId);
          const members = await collectAssetsForFolder(
            ctx,
            ownerUserIds,
            folderId,
            PROJECT_COLLECTION_ASSET_LIMIT,
          );
          const assets = await hydrateGalleryAssetResults(ctx, members);
          return {
            folderId,
            name: collectionFolder?.name ?? "Untitled collection",
            description: collectionFolder?.description,
            section,
            coverAssetId: collectionFolder?.coverAssetId,
            pinnedAt: collectionFolder?.pinnedAt,
            beatCharacterFolderIds,
            beatLocationFolderIds,
            count: assets.length,
            assets,
          };
        },
      ),
    );

    // Viewer likes from the shared board, grouped per asset and per whole
    // direction, with the names viewers chose to leave (anonymous likes count
    // but add no name).
    const reactions = await ctx.db
      .query("boardReactions")
      .withIndex("by_project", (q) => q.eq("projectId", folder._id))
      .collect();
    const likesByAsset = new Map<
      Id<"assets">,
      { count: number; names: Set<string> }
    >();
    const likesByFolder = new Map<
      Id<"folders">,
      { count: number; names: Set<string> }
    >();
    for (const reaction of reactions) {
      if (reaction.assetId) {
        const entry = likesByAsset.get(reaction.assetId) ?? {
          count: 0,
          names: new Set<string>(),
        };
        entry.count += 1;
        if (reaction.viewerName) entry.names.add(reaction.viewerName);
        likesByAsset.set(reaction.assetId, entry);
      } else if (reaction.folderId) {
        const entry = likesByFolder.get(reaction.folderId) ?? {
          count: 0,
          names: new Set<string>(),
        };
        entry.count += 1;
        if (reaction.viewerName) entry.names.add(reaction.viewerName);
        likesByFolder.set(reaction.folderId, entry);
      }
    }
    const assetLikes = [...likesByAsset.entries()].map(
      ([assetId, entry]) => ({
        assetId,
        count: entry.count,
        names: [...entry.names],
      }),
    );
    const collectionLikes = [...likesByFolder.entries()].map(
      ([folderId, entry]) => ({
        folderId,
        count: entry.count,
        names: [...entry.names],
      }),
    );

    return {
      project: {
        _id: folder._id,
        name: folder.name,
        brief: folder.description,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      },
      collections,
      assetLikes,
      collectionLikes,
    };
  },
});

// Validate a folder exists and is owner-accessible; return it. Optionally
// require a specific kind.
const requireOwnedFolder = async (
  ctx: MutationCtx,
  ownerUserId: string,
  folderId: Id<"folders">,
  requiredKind?: "project",
): Promise<Doc<"folders">> => {
  const folder = await ctx.db.get(folderId);
  if (!folder) {
    throw new ConvexError("Folder not found.");
  }
  if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
    throw new ConvexError("Folder does not belong to this user.");
  }
  if (requiredKind && folder.kind !== requiredKind) {
    throw new ConvexError(`Folder is not a ${requiredKind}.`);
  }
  return folder;
};

export const addCollectionToProject = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    folderId: v.id("folders"),
    section: optionalProjectSectionValidator,
  },
  returns: v.object({ added: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (args.projectId === args.folderId) {
      throw new ConvexError("A project cannot contain itself.");
    }

    await requireOwnedFolder(ctx, ownerUserId, args.projectId, "project");
    const collection = await requireOwnedFolder(
      ctx,
      ownerUserId,
      args.folderId,
    );
    if (collection.kind === "project") {
      throw new ConvexError("Projects cannot be nested inside projects.");
    }

    const existing = await ctx.db
      .query("projectCollections")
      .withIndex("by_project_folder", (q) =>
        q.eq("projectId", args.projectId).eq("folderId", args.folderId),
      )
      .unique();
    if (existing) {
      // Re-adding into a specific layer refiles the existing membership.
      if (args.section && existing.section !== args.section) {
        await ctx.db.patch(existing._id, { section: args.section });
        await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
      }
      return { added: false };
    }

    await ctx.db.insert("projectCollections", {
      ownerUserId,
      projectId: args.projectId,
      folderId: args.folderId,
      section: args.section,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
    return { added: true };
  },
});

// Set which character / location directions a beat uses (all must be member
// collections of the same project). Replaces both lists wholesale; writes go
// to the array fields, clearing the legacy single-id pair.
export const setBeatLinks = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    folderId: v.id("folders"),
    characterFolderIds: v.array(v.id("folders")),
    locationFolderIds: v.array(v.id("folders")),
  },
  returns: v.object({ updated: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await requireOwnedFolder(ctx, ownerUserId, args.projectId, "project");

    const existing = await ctx.db
      .query("projectCollections")
      .withIndex("by_project_folder", (q) =>
        q.eq("projectId", args.projectId).eq("folderId", args.folderId),
      )
      .unique();
    if (!existing) {
      throw new ConvexError("Collection is not part of this project.");
    }

    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const memberIds = new Set(
      await collectProjectCollectionIds(ctx, ownerUserIds, args.projectId),
    );
    const characterFolderIds = [...new Set(args.characterFolderIds)];
    const locationFolderIds = [...new Set(args.locationFolderIds)];
    for (const linkedId of [...characterFolderIds, ...locationFolderIds]) {
      if (!memberIds.has(linkedId) || linkedId === args.folderId) {
        throw new ConvexError("Linked direction is not part of this project.");
      }
    }

    await ctx.db.patch(existing._id, {
      beatCharacterFolderId: undefined,
      beatLocationFolderId: undefined,
      beatCharacterFolderIds: characterFolderIds,
      beatLocationFolderIds: locationFolderIds,
    });
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
    return { updated: true };
  },
});

// File (or unfile) a member collection under one of the project's layers.
// null clears the section back to "unsorted".
export const setProjectCollectionSection = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    folderId: v.id("folders"),
    section: v.union(projectSectionValidator, v.null()),
  },
  returns: v.object({ updated: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await requireOwnedFolder(ctx, ownerUserId, args.projectId, "project");

    const existing = await ctx.db
      .query("projectCollections")
      .withIndex("by_project_folder", (q) =>
        q.eq("projectId", args.projectId).eq("folderId", args.folderId),
      )
      .unique();
    if (!existing) {
      throw new ConvexError("Collection is not part of this project.");
    }
    const section = args.section ?? undefined;
    if (existing.section === section) {
      return { updated: false };
    }
    await ctx.db.patch(existing._id, { section });
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
    return { updated: true };
  },
});

export const removeCollectionFromProject = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    folderId: v.id("folders"),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await requireOwnedFolder(ctx, ownerUserId, args.projectId, "project");

    const existing = await ctx.db
      .query("projectCollections")
      .withIndex("by_project_folder", (q) =>
        q.eq("projectId", args.projectId).eq("folderId", args.folderId),
      )
      .unique();
    if (!existing) {
      return { removed: false };
    }
    await ctx.db.delete(existing._id);
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
    return { removed: true };
  },
});
