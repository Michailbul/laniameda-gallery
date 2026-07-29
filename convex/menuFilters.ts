import { mutation, query, type QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { canonicalTagKey, findTagIdsByCanonicalKeys } from "./helpers";
import {
  canActorAccessOwnerUserId,
  resolveUserIdCandidates,
} from "./authz";

// Curated filter pills for the main gallery menu. The owner decides which
// filters surface (the raw tag cloud never renders directly). Two kinds:
//   "tag"        — matches assets carrying any tag whose canonical name equals
//                  one of the entry's tagNames (duplicate tag docs collapse).
//   "collection" — filters the grid to a folder's members (assetFolders +
//                  the legacy folderId alias), e.g. Characters / Locations.
// Counts returned by listMenuFilters use the exact same predicates the grid
// filter applies, so the pill number always matches what a click shows.

const menuFilterKindValidator = v.union(
  v.literal("tag"),
  v.literal("collection"),
);

const menuFilterResultValidator = v.object({
  _id: v.id("menuFilters"),
  label: v.string(),
  kind: menuFilterKindValidator,
  tagNames: v.optional(v.array(v.string())),
  // Resolved at read time for "tag" entries: every tags-table doc whose
  // canonical name matches. The client passes these straight to the gallery
  // query's tagIds filter.
  tagIds: v.array(v.id("tags")),
  folderId: v.optional(v.id("folders")),
  sortOrder: v.number(),
  count: v.number(),
});

const requireOwnerUserId = (raw: string) => {
  const ownerUserId = raw.trim();
  if (!ownerUserId) {
    throw new ConvexError("ownerUserId is required.");
  }
  return ownerUserId;
};

const normalizeTagNames = (raw: string[] | undefined) => {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    const trimmed = entry.trim();
    const canonical = canonicalTagKey(trimmed);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    names.push(trimmed);
  }
  return names;
};

const getOwnedMenuFilter = async (
  ctx: QueryCtx,
  ownerUserId: string,
  menuFilterId: Id<"menuFilters">,
) => {
  const entry = await ctx.db.get(menuFilterId);
  if (!entry || !canActorAccessOwnerUserId(ownerUserId, entry.ownerUserId)) {
    throw new ConvexError("Menu filter not found.");
  }
  return entry;
};

const listOwnerMenuFilters = async (ctx: QueryCtx, ownerUserId: string) => {
  const rows: Doc<"menuFilters">[] = [];
  const seen = new Set<string>();
  for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
    const rowsForOwner = await ctx.db
      .query("menuFilters")
      .withIndex("by_owner_sortOrder", (q) =>
        q.eq("ownerUserId", ownerCandidate).gte("sortOrder", Number.MIN_SAFE_INTEGER),
      )
      .collect();
    for (const row of rowsForOwner) {
      if (seen.has(row._id)) continue;
      seen.add(row._id);
      rows.push(row);
    }
  }
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
  );
};

// Every tags-table doc whose canonical name matches one of the entry's names
// (pre-resolved via the by_canonicalKey index).
const resolveTagIdsForNames = (
  tagIdsByKey: Map<string, Id<"tags">[]>,
  tagNames: string[] | undefined,
) => {
  const ids: Id<"tags">[] = [];
  for (const name of tagNames ?? []) {
    const key = canonicalTagKey(name);
    if (!key) continue;
    ids.push(...(tagIdsByKey.get(key) ?? []));
  }
  return Array.from(new Set(ids));
};

// Distinct asset ids reachable through a folder, read from the assetFolders
// join rows ONLY (tiny docs — never the fat asset documents). The gallery's
// folder filter also honors the legacy assets.folderId alias, but membership
// upkeep (membershipAudit, the folder mutations, delete cleanup) guarantees
// every alias has a matching link row, so links alone give the same set.
const collectFolderMemberAssetIds = async (
  ctx: QueryCtx,
  folderId: Id<"folders">,
) => {
  const memberIds = new Set<Id<"assets">>();
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_folder_createdAt", (q) =>
      q.eq("folderId", folderId).gte("createdAt", 0),
    )
    .collect();
  for (const link of links) {
    memberIds.add(link.assetId);
  }
  return memberIds;
};

// Distinct asset ids carrying any of the given tags, read from the assetTags
// join rows ONLY. Tags (and their links) are not owner-scoped tables; in this
// single-owner vault every link points at the owner's assets, so the count
// matches the owner-scoped grid exactly. If the app ever grows real
// multi-tenancy these counts become upper bounds and should move to an
// owner-scoped index — the grid itself stays correct either way.
const collectTaggedAssetIds = async (
  ctx: QueryCtx,
  tagIds: Id<"tags">[],
) => {
  const assetIds = new Set<Id<"assets">>();
  for (const tagId of tagIds) {
    const links = await ctx.db
      .query("assetTags")
      .withIndex("by_tag_createdAt", (q) =>
        q.eq("tagId", tagId).gte("createdAt", 0),
      )
      .collect();
    for (const link of links) {
      assetIds.add(link.assetId);
    }
  }
  return assetIds;
};

const buildMenuFilters = async (
  ctx: QueryCtx,
  ownerUserId: string,
  isPublic: boolean | undefined,
) => {
  {
    const entries = await listOwnerMenuFilters(ctx, ownerUserId);
    if (entries.length === 0) return [];

    // Indexed per-key tag lookups (only the keys the pills actually name).
    const wantedKeys = entries
      .filter((entry) => entry.kind === "tag")
      .flatMap((entry) => entry.tagNames ?? [])
      .map((name) => canonicalTagKey(name))
      .filter((key) => key.length > 0);
    const tagIdsByKey = await findTagIdsByCanonicalKeys(ctx, wantedKeys);

    // Counting never touches the fat asset documents in the owner ("mine")
    // scope — every count comes from the small assetTags / assetFolders join
    // rows. That keeps this query's read bandwidth roughly two orders of
    // magnitude below the previous full-vault scan AND stops it re-running
    // on unrelated asset edits (only tag / membership changes invalidate it
    // now). The public scope still reads assets, but only the isPublic slice
    // via its index.
    const publicAssetIds = isPublic
      ? new Set(
          (
            await ctx.db
              .query("assets")
              .withIndex("by_isPublic_createdAt", (q) => q.eq("isPublic", true))
              .collect()
          ).map((asset) => asset._id),
        )
      : null;

    const countInScope = (assetIds: Set<Id<"assets">>) => {
      if (!publicAssetIds) return assetIds.size;
      let count = 0;
      for (const assetId of assetIds) {
        if (publicAssetIds.has(assetId)) count += 1;
      }
      return count;
    };

    const results = [];
    for (const entry of entries) {
      if (entry.kind === "tag") {
        const tagIds = resolveTagIdsForNames(tagIdsByKey, entry.tagNames);
        const count =
          tagIds.length === 0
            ? 0
            : countInScope(await collectTaggedAssetIds(ctx, tagIds));
        results.push({
          _id: entry._id,
          label: entry.label,
          kind: entry.kind,
          tagNames: entry.tagNames,
          tagIds,
          folderId: undefined,
          sortOrder: entry.sortOrder,
          count,
        });
        continue;
      }

      const count = entry.folderId
        ? countInScope(await collectFolderMemberAssetIds(ctx, entry.folderId))
        : 0;
      results.push({
        _id: entry._id,
        label: entry.label,
        kind: entry.kind,
        tagNames: undefined,
        tagIds: [] as Id<"tags">[],
        folderId: entry.folderId,
        sortOrder: entry.sortOrder,
        count,
      });
    }
    return results;
  }
};

export const listMenuFilters = query({
  args: {
    ownerUserId: v.string(),
    // Count against the public gallery (isPublic assets) instead of the
    // owner's full vault. The entries themselves are always the owner's.
    isPublic: v.optional(v.boolean()),
  },
  returns: v.array(menuFilterResultValidator),
  handler: (ctx, args) =>
    buildMenuFilters(ctx, requireOwnerUserId(args.ownerUserId), args.isPublic),
});

// Authless twin for the public landing page: the same curated pills, pinned to
// the showcase owner and always counted over the public slice. Anonymous
// visitors get the pills without ever naming an owner id.
export const listPublicMenuFilters = query({
  args: {},
  returns: v.array(menuFilterResultValidator),
  handler: async (ctx) => {
    const owner = (
      process.env.SHOWCASE_OWNER_USER_ID ??
      process.env.KB_OWNER_USER_ID ??
      ""
    ).trim();
    if (!owner) return [];
    return buildMenuFilters(ctx, owner, true);
  },
});

const assertValidMapping = async (
  ctx: QueryCtx,
  ownerUserId: string,
  kind: "tag" | "collection",
  tagNames: string[],
  folderId: Id<"folders"> | undefined,
) => {
  if (kind === "tag") {
    if (tagNames.length === 0) {
      throw new ConvexError("A tag filter needs at least one tag name.");
    }
    return;
  }
  if (!folderId) {
    throw new ConvexError("A collection filter needs a collection.");
  }
  const folder = await ctx.db.get(folderId);
  if (!folder || !canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
    throw new ConvexError("Collection not found.");
  }
  if (folder.kind === "project" || folder.kind === "beat") {
    throw new ConvexError(
      "Only collections and storybooks can back a menu filter.",
    );
  }
};

export const createMenuFilter = mutation({
  args: {
    ownerUserId: v.string(),
    label: v.string(),
    kind: menuFilterKindValidator,
    tagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.id("folders")),
  },
  returns: v.id("menuFilters"),
  handler: async (ctx, args) => {
    const ownerUserId = requireOwnerUserId(args.ownerUserId);
    const label = args.label.trim();
    if (!label) {
      throw new ConvexError("Label is required.");
    }
    const tagNames = normalizeTagNames(args.tagNames);
    await assertValidMapping(ctx, ownerUserId, args.kind, tagNames, args.folderId);

    const existing = await listOwnerMenuFilters(ctx, ownerUserId);
    const maxOrder = existing.reduce(
      (max, entry) => Math.max(max, entry.sortOrder),
      -1,
    );
    const now = Date.now();
    return await ctx.db.insert("menuFilters", {
      ownerUserId,
      label,
      kind: args.kind,
      tagNames: args.kind === "tag" ? tagNames : undefined,
      folderId: args.kind === "collection" ? args.folderId : undefined,
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateMenuFilter = mutation({
  args: {
    ownerUserId: v.string(),
    menuFilterId: v.id("menuFilters"),
    label: v.optional(v.string()),
    tagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.id("folders")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = requireOwnerUserId(args.ownerUserId);
    const entry = await getOwnedMenuFilter(ctx, ownerUserId, args.menuFilterId);

    const patch: Partial<Doc<"menuFilters">> = { updatedAt: Date.now() };
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) {
        throw new ConvexError("Label is required.");
      }
      patch.label = label;
    }
    if (entry.kind === "tag" && args.tagNames !== undefined) {
      const tagNames = normalizeTagNames(args.tagNames);
      await assertValidMapping(ctx, ownerUserId, "tag", tagNames, undefined);
      patch.tagNames = tagNames;
    }
    if (entry.kind === "collection" && args.folderId !== undefined) {
      await assertValidMapping(ctx, ownerUserId, "collection", [], args.folderId);
      patch.folderId = args.folderId;
    }
    await ctx.db.patch(entry._id, patch);
    return null;
  },
});

export const deleteMenuFilter = mutation({
  args: {
    ownerUserId: v.string(),
    menuFilterId: v.id("menuFilters"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = requireOwnerUserId(args.ownerUserId);
    const entry = await getOwnedMenuFilter(ctx, ownerUserId, args.menuFilterId);
    await ctx.db.delete(entry._id);
    return null;
  },
});

export const reorderMenuFilters = mutation({
  args: {
    ownerUserId: v.string(),
    orderedIds: v.array(v.id("menuFilters")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = requireOwnerUserId(args.ownerUserId);
    const now = Date.now();
    for (const [index, menuFilterId] of args.orderedIds.entries()) {
      const entry = await getOwnedMenuFilter(ctx, ownerUserId, menuFilterId);
      if (entry.sortOrder !== index) {
        await ctx.db.patch(entry._id, { sortOrder: index, updatedAt: now });
      }
    }
    return null;
  },
});

