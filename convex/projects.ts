import { mutation, query } from "./_generated/server";
import { v, ConvexError, type Infer } from "convex/values";
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
import { canonicalFolderName, recountFolderMembers } from "./folderHelpers";
import {
  optionalProjectSectionValidator,
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
  // The world this project sits inside, when it's been filed into one. Absent
  // = a root-level project that is its own world.
  world: v.optional(
    v.object({ folderId: v.id("folders"), name: v.string() }),
  ),
  collectionCount: v.number(),
  assetCount: v.number(),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  previewAssets: v.array(projectPreviewValidator),
  // Member beats, so the sidebar can offer them as drop targets.
  collections: v.array(
    v.object({
      folderId: v.id("folders"),
      name: v.string(),
      section: optionalProjectSectionValidator,
    }),
  ),
});

export type ProjectSection =
  | "characters"
  | "locations"
  | "stills"
  | "beats"
  | "episodes";

export type ProjectCollectionLink = {
  folderId: Id<"folders">;
  section?: ProjectSection;
  beatCharacterFolderIds: Id<"folders">[];
  beatLocationFolderIds: Id<"folders">[];
  /** Beat rows only: the episode this beat is filed under. */
  episodeFolderId?: Id<"folders">;
  episodeOrder?: number;
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
      beatCharacterFolderIds: row.beatCharacterFolderIds ?? [],
      beatLocationFolderIds: row.beatLocationFolderIds ?? [],
      episodeFolderId: row.episodeFolderId,
      episodeOrder: row.episodeOrder,
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
        const memberFolderDocs = await Promise.all(
          collectionLinks.map(({ folderId }) => ctx.db.get(folderId)),
        );
        const memberCollections = collectionLinks.map(
          ({ folderId, section }, index) => ({
            folderId,
            name: memberFolderDocs[index]?.name ?? "Untitled collection",
            section,
          }),
        );

        // Count = DEDUPED union across member collections (an asset can sit
        // in several members — e.g. a recurring character set — and must not
        // count twice; summing memberCounts visibly inflated project rows).
        // Link rows are tiny and the walk is capped per collection, so this
        // stays cheap; the expensive per-write recounts live elsewhere.
        const seenAssets = new Set<string>();
        const orderedMemberIds: Id<"assets">[] = [];
        for (const folderId of collectionIds) {
          for (const ownerCandidate of ownerUserIds) {
            const links = await ctx.db
              .query("assetFolders")
              .withIndex("by_owner_folder_createdAt", (q) =>
                q
                  .eq("ownerUserId", ownerCandidate)
                  .eq("folderId", folderId)
                  .gte("createdAt", 0),
              )
              .order("desc")
              .take(PROJECT_COLLECTION_ASSET_LIMIT);
            for (const link of links) {
              if (seenAssets.has(link.assetId)) continue;
              seenAssets.add(link.assetId);
              orderedMemberIds.push(link.assetId);
            }
          }
        }
        const assetCount = seenAssets.size;
        const previewDocs = (
          await Promise.all(
            orderedMemberIds
              .slice(0, STACK_PREVIEW_LIMIT)
              .map(async (assetId) => await ctx.db.get(assetId)),
          )
        ).filter((asset): asset is Doc<"assets"> => asset !== null);

        const previews = await Promise.all(
          previewDocs.map(async (asset) => {
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

        const worldFolder =
          folder.parentFolderId !== undefined
            ? await ctx.db.get(folder.parentFolderId)
            : null;

        return {
          _id: folder._id,
          name: folder.name,
          brief: folder.description,
          world: worldFolder
            ? { folderId: worldFolder._id, name: worldFolder.name }
            : undefined,
          collectionCount: collectionIds.length,
          assetCount,
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

// A project's beats presented as STACK cards in the main gallery grid: cover
// tile + fanned peek thumbs on hover. The flat grid excludes these members
// (assets:listGalleryAssets excludeBeatAssets) so nothing shows twice.
const beatStackValidator = v.object({
  folderId: v.id("folders"),
  name: v.string(),
  count: v.number(),
  cover: v.optional(projectPreviewValidator),
  // Thumb urls of everything inside (cover first, capped) for the hover fan.
  peekThumbs: v.array(v.string()),
  // Every member asset id — the client collapses these out of the flat grid
  // when the beat renders as a stack card.
  memberAssetIds: v.array(v.id("assets")),
  createdAt: v.optional(v.number()),
});

const BEAT_PEEK_LIMIT = 8;

// One beat (beat folder) as a grid stack card: MASTER-first cover,
// capped peek thumbs, full member id list. Null when the folder is gone.
const buildBeatStack = async (
  ctx: QueryCtx,
  ownerUserIds: string[],
  beatFolderId: Id<"folders">,
) => {
  const folder = await ctx.db.get(beatFolderId);
  if (!folder) return null;
  const members = await collectAssetsForFolder(
    ctx,
    ownerUserIds,
    beatFolderId,
    PROJECT_COLLECTION_ASSET_LIMIT,
  );
  // The beat's MASTER asset fronts the stack; first member otherwise.
  const coverAsset =
    (folder.coverAssetId &&
      members.find((asset) => asset._id === folder.coverAssetId)) ||
    members[0];
  const ordered = coverAsset
    ? [coverAsset, ...members.filter((asset) => asset !== coverAsset)]
    : members;

  const peekThumbs = (
    await Promise.all(
      ordered.slice(0, BEAT_PEEK_LIMIT).map(async (asset) => {
        const [thumbUrl, url] = await Promise.all([
          resolveAssetThumbUrl(ctx, asset),
          resolveAssetUrl(ctx, asset),
        ]);
        return thumbUrl ?? url;
      }),
    )
  ).filter((src): src is string => Boolean(src));

  let cover;
  if (coverAsset) {
    const [url, thumbUrl] = await Promise.all([
      resolveAssetUrl(ctx, coverAsset),
      resolveAssetThumbUrl(ctx, coverAsset),
    ]);
    cover = {
      assetId: coverAsset._id,
      kind: coverAsset.kind,
      contentType: coverAsset.contentType,
      url: url ?? undefined,
      thumbUrl: thumbUrl ?? undefined,
      width: coverAsset.width,
      height: coverAsset.height,
      thumbWidth: coverAsset.thumbWidth,
      thumbHeight: coverAsset.thumbHeight,
    };
  }

  return {
    folderId: beatFolderId,
    name: folder.name,
    count: members.length,
    cover,
    peekThumbs,
    memberAssetIds: members.map((asset) => asset._id),
    createdAt: folder.createdAt,
  };
};

export const listProjectBeatStacks = query({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
  },
  returns: v.array(beatStackValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const links = await collectProjectCollectionLinks(
      ctx,
      ownerUserIds,
      args.projectId,
    );
    const beatLinks = links.filter((link) => link.section === "beats");

    const stacks = [];
    for (const link of beatLinks) {
      const stack = await buildBeatStack(ctx, ownerUserIds, link.folderId);
      if (stack) stacks.push(stack);
    }
    return stacks;
  },
});

// Beats that live INSIDE a plain collection: every beat (any project's
// "beats"-section beat) whose members are all members of the collection.
// Lets a collection that mirrors a project's pool — e.g. "Cassandra
// Collection" — browse with the same stack cards as the project itself.
export const listCollectionBeatStacks = query({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
  },
  returns: v.array(beatStackValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    // The collection's member set, from the tiny join rows.
    const collectionMemberIds = new Set<string>();
    for (const ownerCandidate of ownerUserIds) {
      const links = await ctx.db
        .query("assetFolders")
        .withIndex("by_owner_folder_createdAt", (q) =>
          q
            .eq("ownerUserId", ownerCandidate)
            .eq("folderId", args.folderId)
            .gte("createdAt", 0),
        )
        .collect();
      for (const link of links) {
        collectionMemberIds.add(link.assetId);
      }
    }
    if (collectionMemberIds.size === 0) return [];

    // Every beat across the owner's projects, deduped.
    const projects = await collectOwnerProjectFolders(ctx, ownerUserIds);
    const beatFolderIds: Id<"folders">[] = [];
    const seenBeats = new Set<string>();
    for (const project of projects) {
      const links = await collectProjectCollectionLinks(
        ctx,
        ownerUserIds,
        project._id,
      );
      for (const link of links) {
        if (link.section !== "beats" || seenBeats.has(link.folderId)) continue;
        seenBeats.add(link.folderId);
        beatFolderIds.push(link.folderId);
      }
    }

    const stacks = [];
    for (const beatFolderId of beatFolderIds) {
      if (beatFolderId === args.folderId) continue;
      // Membership check on link rows only — cheap enough to run per beat.
      const memberIds = new Set<string>();
      for (const ownerCandidate of ownerUserIds) {
        const links = await ctx.db
          .query("assetFolders")
          .withIndex("by_owner_folder_createdAt", (q) =>
            q
              .eq("ownerUserId", ownerCandidate)
              .eq("folderId", beatFolderId)
              .gte("createdAt", 0),
          )
          .collect();
        for (const link of links) {
          memberIds.add(link.assetId);
        }
      }
      if (memberIds.size === 0) continue;
      let contained = true;
      for (const assetId of memberIds) {
        if (!collectionMemberIds.has(assetId)) {
          contained = false;
          break;
        }
      }
      if (!contained) continue;

      const stack = await buildBeatStack(ctx, ownerUserIds, beatFolderId);
      if (stack) stacks.push(stack);
    }
    return stacks;
  },
});

// The full project "review" payload — the workspace view model. The shared
// public board (beatBoard.getBoardWorkspace) returns this SAME shape so
// the review UI renders identically for owner and anonymous viewer.
export const projectViewValidator = v.object({
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
  // …and per beat (beat cards on the board take whole-beat likes).
  collectionLikes: v.array(
    v.object({
      folderId: v.id("folders"),
      count: v.number(),
      names: v.array(v.string()),
    }),
  ),
});

export type ProjectView = Infer<typeof projectViewValidator>;

/**
 * Build the review payload for a project folder. Shared by the owner query
 * (getProject) and the token-gated public board (beatBoard). Pure read —
 * the caller is responsible for auth (owner) or token resolution (public).
 */
export const buildProjectView = async (
  ctx: QueryCtx,
  ownerUserIds: string[],
  folder: Doc<"folders">,
): Promise<ProjectView> => {
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

  // An asset is presented ONCE: unsectioned collections (the Inbox / staging
  // pool) hide anything that's already filed into a sectioned collection
  // (beat / characters / locations / stills). Without this, an inbox leftover
  // renders both in its beat stack AND in the unsorted list.
  const filedAssetIds = new Set<string>();
  for (const collection of collections) {
    if (collection.section === undefined) continue;
    for (const asset of collection.assets) {
      filedAssetIds.add(asset._id);
    }
  }
  for (const collection of collections) {
    if (collection.section !== undefined) continue;
    const unfiled = collection.assets.filter(
      (asset) => !filedAssetIds.has(asset._id),
    );
    if (unfiled.length !== collection.assets.length) {
      collection.assets = unfiled;
      collection.count = unfiled.length;
    }
  }

  // Viewer likes from the shared board, grouped per asset and per whole
  // beat, with the names viewers chose to leave (anonymous likes count
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
  const assetLikes = [...likesByAsset.entries()].map(([assetId, entry]) => ({
    assetId,
    count: entry.count,
    names: [...entry.names],
  }));
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
};

export const getProject = query({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
  },
  returns: v.union(v.null(), projectViewValidator),
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
    return await buildProjectView(ctx, ownerUserIds, folder);
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

/**
 * File loose assets into a project. Membership semantics: an asset is "in" a
 * project when it belongs to ANY of the project's member collections — so
 * assets already present (e.g. living inside a beat) are SKIPPED, not
 * double-filed. Only genuinely new assets land in the project's "— Inbox"
 * beat, ready to be sorted into beats from the workspace.
 */
export const addAssetsToProject = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    assetIds: v.array(v.id("assets")),
  },
  returns: v.object({
    added: v.number(),
    skipped: v.number(),
    inboxFolderId: v.union(v.id("folders"), v.null()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const project = await requireOwnedFolder(
      ctx,
      ownerUserId,
      args.projectId,
      "project",
    );

    const memberLinks = await ctx.db
      .query("projectCollections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const memberFolderIds = new Set(memberLinks.map((link) => link.folderId));

    // Partition: already-in-project vs genuinely new.
    const toAdd: Id<"assets">[] = [];
    let skipped = 0;
    for (const assetId of Array.from(new Set(args.assetIds))) {
      const asset = await ctx.db.get(assetId);
      if (!asset) continue;
      if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
        throw new ConvexError("Asset does not belong to this user.");
      }
      let inProject = Boolean(
        asset.folderId && memberFolderIds.has(asset.folderId),
      );
      if (!inProject) {
        const links = await ctx.db
          .query("assetFolders")
          .withIndex("by_asset", (q) => q.eq("assetId", assetId))
          .collect();
        inProject = links.some((link) => memberFolderIds.has(link.folderId));
      }
      if (inProject) {
        skipped += 1;
      } else {
        toAdd.push(assetId);
      }
    }

    if (toAdd.length === 0) {
      return { added: 0, skipped, inboxFolderId: null };
    }

    // Ensure the project's Inbox beat exists and is a member.
    const inboxName = `${project.name} — Inbox`;
    const normalizedInboxName = canonicalFolderName(inboxName);
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    let inbox = null;
    for (const ownerCandidate of ownerUserIds) {
      inbox = await ctx.db
        .query("folders")
        .withIndex("by_owner_normalizedName", (q) =>
          q
            .eq("ownerUserId", ownerCandidate)
            .eq("normalizedName", normalizedInboxName),
        )
        .unique();
      if (inbox) break;
    }
    const now = Date.now();
    const inboxFolderId = inbox
      ? inbox._id
      : await ctx.db.insert("folders", {
          ownerUserId,
          name: inboxName,
          normalizedName: normalizedInboxName,
          kind: "beat",
          createdAt: now,
          updatedAt: now,
        });
    if (!memberFolderIds.has(inboxFolderId)) {
      const existingLink = await ctx.db
        .query("projectCollections")
        .withIndex("by_project_folder", (q) =>
          q.eq("projectId", args.projectId).eq("folderId", inboxFolderId),
        )
        .unique();
      if (!existingLink) {
        await ctx.db.insert("projectCollections", {
          ownerUserId,
          projectId: args.projectId,
          folderId: inboxFolderId,
          createdAt: now,
        });
      }
    }

    for (const assetId of toAdd) {
      const existing = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset_folder", (q) =>
          q.eq("assetId", assetId).eq("folderId", inboxFolderId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("assetFolders", {
          ownerUserId,
          assetId,
          folderId: inboxFolderId,
          createdAt: now,
        });
      }
    }

    await recountFolderMembers(ctx, [inboxFolderId]);
    return { added: toAdd.length, skipped, inboxFolderId };
  },
});

/**
 * Remove assets from every member collection of a project while preserving
 * their memberships outside that project. This is the inverse of
 * addAssetsToProject and is intentionally idempotent for checklist-style UI.
 */
export const removeAssetsFromProject = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    assetIds: v.array(v.id("assets")),
  },
  returns: v.object({
    removed: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await requireOwnedFolder(ctx, ownerUserId, args.projectId, "project");

    const memberLinks = await ctx.db
      .query("projectCollections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const memberFolderIds = new Set(
      memberLinks.map((link) => link.folderId),
    );

    let removed = 0;
    let skipped = 0;
    const touchedFolderIds = new Set<Id<"folders">>();
    for (const assetId of Array.from(new Set(args.assetIds))) {
      const asset = await ctx.db.get(assetId);
      if (!asset) {
        skipped += 1;
        continue;
      }
      if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
        throw new ConvexError("Asset does not belong to this user.");
      }

      const assetFolderLinks = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset", (q) => q.eq("assetId", assetId))
        .collect();
      const projectLinks = assetFolderLinks.filter((link) =>
        memberFolderIds.has(link.folderId),
      );
      const legacyProjectMembership = Boolean(
        asset.folderId && memberFolderIds.has(asset.folderId),
      );

      if (projectLinks.length === 0 && !legacyProjectMembership) {
        skipped += 1;
        continue;
      }

      for (const link of projectLinks) {
        await ctx.db.delete(link._id);
        touchedFolderIds.add(link.folderId);
      }
      if (legacyProjectMembership) {
        const nextPrimary = assetFolderLinks.find(
          (link) => !memberFolderIds.has(link.folderId),
        )?.folderId;
        await ctx.db.patch(assetId, { folderId: nextPrimary });
      }
      removed += 1;
    }

    await recountFolderMembers(ctx, touchedFolderIds);
    return { removed, skipped };
  },
});

/**
 * File an asset into one of a project's member collections (drop on a beat /
 * stack). MOVE semantics relative to the project's staging pool: the asset is
 * linked to the target and its links to the project's UNSECTIONED member
 * collections (the Inbox) are removed — filing drains staging instead of
 * duplicating. Memberships outside this project are untouched.
 */
export const fileAssetIntoProjectCollection = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    assetId: v.id("assets"),
    folderId: v.id("folders"),
  },
  returns: v.object({ filed: v.boolean(), drained: v.number() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await requireOwnedFolder(ctx, ownerUserId, args.projectId, "project");
    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    const memberLinks = await ctx.db
      .query("projectCollections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const target = memberLinks.find((link) => link.folderId === args.folderId);
    if (!target) {
      throw new ConvexError("Target collection is not part of this project.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("assetFolders")
      .withIndex("by_asset_folder", (q) =>
        q.eq("assetId", args.assetId).eq("folderId", args.folderId),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("assetFolders", {
        ownerUserId,
        assetId: args.assetId,
        folderId: args.folderId,
        createdAt: now,
      });
    }

    // Drain the staging pool: unsectioned member collections lose this asset.
    let drained = 0;
    const unsortedFolderIds = memberLinks
      .filter(
        (link) => link.section === undefined && link.folderId !== args.folderId,
      )
      .map((link) => link.folderId);
    for (const unsortedFolderId of unsortedFolderIds) {
      const link = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset_folder", (q) =>
          q.eq("assetId", args.assetId).eq("folderId", unsortedFolderId),
        )
        .unique();
      if (link) {
        await ctx.db.delete(link._id);
        drained += 1;
      }
      if (asset.folderId === unsortedFolderId) {
        await ctx.db.patch(args.assetId, { folderId: undefined });
      }
    }

    await recountFolderMembers(ctx, [args.folderId, ...unsortedFolderIds]);
    return { filed: !existing, drained };
  },
});

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

// The default holding folder for one of a world's sections — "CASSANDRA —
// Characters" and friends. Lets the Add-to panel file a character, location,
// or still into a world WITHOUT first inventing a collection for it: the
// section itself is the destination. Idempotent; returns the existing pool
// when one is already attached (matched by section first, then by name, so a
// pool created by the review modal is reused rather than duplicated).
const SECTION_POOL_LABEL = {
  characters: "Characters",
  locations: "Locations",
  stills: "Stills",
} as const;

export const ensureSectionPool = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    // NOT "beats": a beat is one video plus its characters/locations, so
    // beats are never pooled into a shared folder. Callers create one beat
    // folder per asset instead (see createBeatsFromAssets).
    section: v.union(
      v.literal("characters"),
      v.literal("locations"),
      v.literal("stills"),
    ),
  },
  returns: v.object({ folderId: v.id("folders"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const project = await requireOwnedFolder(
      ctx,
      ownerUserId,
      args.projectId,
      "project",
    );
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const poolName = `${project.name} — ${SECTION_POOL_LABEL[args.section]}`;

    // An existing member in this section wins — that IS the pool.
    const links = await collectProjectCollectionLinks(
      ctx,
      ownerUserIds,
      args.projectId,
    );
    for (const link of links) {
      if (link.section !== args.section) continue;
      const folder = await ctx.db.get(link.folderId);
      if (folder?.name === poolName) {
        return { folderId: link.folderId, created: false };
      }
    }

    // Otherwise reuse a detached folder of the same name, or make one.
    let pool: Doc<"folders"> | null = null;
    for (const ownerCandidate of ownerUserIds) {
      pool = await ctx.db
        .query("folders")
        .withIndex("by_owner_normalizedName", (q) =>
          q
            .eq("ownerUserId", ownerCandidate)
            .eq("normalizedName", canonicalFolderName(poolName)),
        )
        .unique();
      if (pool) break;
    }

    const now = Date.now();
    const folderId =
      pool?._id ??
      (await ctx.db.insert("folders", {
        ownerUserId,
        name: poolName,
        normalizedName: canonicalFolderName(poolName),
        kind: "beat",
        createdAt: now,
        updatedAt: now,
      }));

    const existingLink = await ctx.db
      .query("projectCollections")
      .withIndex("by_project_folder", (q) =>
        q.eq("projectId", args.projectId).eq("folderId", folderId),
      )
      .unique();
    if (existingLink) {
      if (existingLink.section !== args.section) {
        await ctx.db.patch(existingLink._id, { section: args.section });
      }
    } else {
      await ctx.db.insert("projectCollections", {
        ownerUserId,
        projectId: args.projectId,
        folderId,
        section: args.section,
        createdAt: now,
      });
    }
    await ctx.db.patch(args.projectId, { updatedAt: now });
    return { folderId, created: pool === null };
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

// ── Episodes ───────────────────────────────────────────────────────────────
// An episode is a chapter of a project that groups its beats: a
// kind:"episode" folder filed in the project's "episodes" layer, which beats
// point at via projectCollections.episodeFolderId. Episodes hold no assets of
// their own — their content IS their beats, so the hierarchy reads
// world > project > episode > beat > statics.

const episodeBeatValidator = v.object({
  folderId: v.id("folders"),
  name: v.string(),
  count: v.number(),
  order: v.optional(v.number()),
  cover: v.optional(projectPreviewValidator),
});

const episodeSummaryValidator = v.object({
  folderId: v.id("folders"),
  name: v.string(),
  synopsis: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  beats: v.array(episodeBeatValidator),
  /** Assets across every beat in the episode. */
  assetCount: v.number(),
  cover: v.optional(projectPreviewValidator),
});

// Create an episode inside a project (idempotent by normalized name, like
// every other folder create) and file it in the "episodes" layer.
export const createEpisode = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    name: v.string(),
    synopsis: v.optional(v.string()),
  },
  returns: v.object({ folderId: v.id("folders"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const project = await requireOwnedFolder(
      ctx,
      ownerUserId,
      args.projectId,
      "project",
    );
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Episode name is required.");
    }
    // Namespaced like the section pools, so "Episode 1" can exist in every
    // project without colliding on folders.normalizedName.
    const scopedName = name.startsWith(`${project.name} — `)
      ? name
      : `${project.name} — ${name}`;
    const normalizedName = canonicalFolderName(scopedName);
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    let existing: Doc<"folders"> | null = null;
    for (const ownerCandidate of ownerUserIds) {
      existing = await ctx.db
        .query("folders")
        .withIndex("by_owner_normalizedName", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("normalizedName", normalizedName),
        )
        .unique();
      if (existing) break;
    }
    if (existing && existing.kind !== "episode") {
      throw new ConvexError(
        `"${name}" already exists as a different kind of collection.`,
      );
    }

    const now = Date.now();
    const folderId =
      existing?._id ??
      (await ctx.db.insert("folders", {
        ownerUserId,
        name: scopedName,
        normalizedName,
        description: args.synopsis?.trim() || undefined,
        kind: "episode",
        createdAt: now,
        updatedAt: now,
      }));

    const link = await ctx.db
      .query("projectCollections")
      .withIndex("by_project_folder", (q) =>
        q.eq("projectId", args.projectId).eq("folderId", folderId),
      )
      .unique();
    if (link) {
      if (link.section !== "episodes") {
        await ctx.db.patch(link._id, { section: "episodes" });
      }
    } else {
      await ctx.db.insert("projectCollections", {
        ownerUserId,
        projectId: args.projectId,
        folderId,
        section: "episodes",
        createdAt: now,
      });
    }
    await ctx.db.patch(args.projectId, { updatedAt: now });
    return { folderId, created: existing === null };
  },
});

// File a beat into an episode, or pass episodeFolderId: null to unfile it.
export const setBeatEpisode = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    beatFolderId: v.id("folders"),
    episodeFolderId: v.union(v.id("folders"), v.null()),
    order: v.optional(v.number()),
  },
  returns: v.object({ filed: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await requireOwnedFolder(ctx, ownerUserId, args.projectId, "project");

    const beatLink = await ctx.db
      .query("projectCollections")
      .withIndex("by_project_folder", (q) =>
        q.eq("projectId", args.projectId).eq("folderId", args.beatFolderId),
      )
      .unique();
    if (!beatLink) {
      throw new ConvexError("That beat is not part of this project.");
    }

    if (args.episodeFolderId !== null) {
      // The episode has to be an episode, and one of THIS project's.
      const episode = await ctx.db.get(args.episodeFolderId);
      if (!episode || episode.kind !== "episode") {
        throw new ConvexError("Target is not an episode.");
      }
      if (!canActorAccessOwnerUserId(ownerUserId, episode.ownerUserId)) {
        throw new ConvexError("Episode does not belong to this user.");
      }
      const episodeLink = await ctx.db
        .query("projectCollections")
        .withIndex("by_project_folder", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("folderId", args.episodeFolderId as Id<"folders">),
        )
        .unique();
      if (!episodeLink) {
        throw new ConvexError("That episode is not part of this project.");
      }
      // An episode can't hold itself, and episodes don't nest.
      if (args.beatFolderId === args.episodeFolderId) {
        throw new ConvexError("An episode can't contain itself.");
      }
    }

    await ctx.db.patch(beatLink._id, {
      episodeFolderId: args.episodeFolderId ?? undefined,
      episodeOrder: args.episodeFolderId === null ? undefined : args.order,
    });
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
    return { filed: args.episodeFolderId !== null };
  },
});

// A project's episodes with the beats filed under each, plus the beats that
// aren't in any episode yet — everything the Episodes tab needs in one read.
export const listProjectEpisodes = query({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
  },
  returns: v.object({
    episodes: v.array(episodeSummaryValidator),
    unassignedBeats: v.array(episodeBeatValidator),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const links = await collectProjectCollectionLinks(
      ctx,
      ownerUserIds,
      args.projectId,
    );

    const episodeLinks = links.filter((link) => link.section === "episodes");
    const beatLinks = links.filter((link) => link.section === "beats");

    const buildBeat = async (link: ProjectCollectionLink) => {
      const folder = await ctx.db.get(link.folderId);
      const assets = await collectAssetsForFolder(
        ctx,
        ownerUserIds,
        link.folderId,
        STACK_PREVIEW_LIMIT,
      );
      const coverDoc =
        (folder?.coverAssetId
          ? await ctx.db.get(folder.coverAssetId)
          : null) ?? assets[0] ?? null;
      const cover = coverDoc
        ? {
            assetId: coverDoc._id,
            kind: coverDoc.kind,
            contentType: coverDoc.contentType,
            url: (await resolveAssetUrl(ctx, coverDoc)) ?? undefined,
            thumbUrl: (await resolveAssetThumbUrl(ctx, coverDoc)) ?? undefined,
            width: coverDoc.width,
            height: coverDoc.height,
            thumbWidth: coverDoc.thumbWidth,
            thumbHeight: coverDoc.thumbHeight,
          }
        : undefined;
      return {
        folderId: link.folderId,
        name: folder?.name ?? "Untitled beat",
        count: folder?.memberCount ?? assets.length,
        order: link.episodeOrder,
        cover,
      };
    };

    const summaries = [];
    for (const episodeLink of episodeLinks) {
      const episode = await ctx.db.get(episodeLink.folderId);
      if (!episode) continue;
      const mine = beatLinks.filter(
        (beat) => beat.episodeFolderId === episodeLink.folderId,
      );
      const beats = await Promise.all(mine.map(buildBeat));
      // Story order: explicit episodeOrder first, unordered beats after.
      beats.sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER),
      );
      summaries.push({
        folderId: episode._id,
        name: episode.name,
        synopsis: episode.description,
        createdAt: episode.createdAt,
        beats,
        assetCount: beats.reduce((total, beat) => total + beat.count, 0),
        cover: beats.find((beat) => beat.cover)?.cover,
      });
    }
    summaries.sort(
      (left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0),
    );

    // Beats whose episode is unset — or points at an episode that has since
    // been deleted, which would otherwise strand them out of every group.
    const episodeIds = new Set(episodeLinks.map((link) => link.folderId));
    const unassignedBeats = await Promise.all(
      beatLinks
        .filter(
          (beat) =>
            beat.episodeFolderId === undefined ||
            !episodeIds.has(beat.episodeFolderId),
        )
        .map(buildBeat),
    );

    return { episodes: summaries, unassignedBeats };
  },
});
