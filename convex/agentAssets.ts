import { ConvexError, v } from "convex/values";
import { signedOwnerQuery } from "./actor";
import type { Id } from "./_generated/dataModel";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { assetRoleValidator } from "./validators";
import { galleryAssetResultValidator, hydrateGalleryAssetResults } from "./galleryAssetResults";
import { buildMenuFilterPredicate, isHiddenSkillExample, isSkillExampleRole, matchesAssetRole, matchesMenuFilters, resolveNamedTagFilters } from "./assets";
import { galleryAssetSearchText } from "../lib/gallery-search";

const ORDER = "owner-candidate-createdAt-desc" as const;
type Cursor = { v: 1; key: string; owner: number; cursor: string | null };

export const listAssetsPage = signedOwnerQuery({
  args: {
    ownerUserId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), pageSize: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    folderId: v.optional(v.id("folders")), includeDescendants: v.optional(v.boolean()),
    includeSkillExamples: v.optional(v.boolean()), includeWorkflowAssets: v.optional(v.boolean()), modelName: v.optional(v.string()), assetRole: assetRoleValidator,
    tagNames: v.optional(v.array(v.string())), anyTagNames: v.optional(v.array(v.string())), excludeTagNames: v.optional(v.array(v.string())),
    tagIdGroups: v.optional(v.array(v.array(v.id("tags")))), excludeTagIds: v.optional(v.array(v.id("tags"))),
    excludeFolderIds: v.optional(v.array(v.id("folders"))),
    pieceType: v.optional(v.union(v.literal("character"), v.literal("location"), v.literal("scene"), v.literal("inspiration"))),
    medium: v.optional(v.union(v.literal("animation"), v.literal("live-action"))),
    onlyLiked: v.optional(v.boolean()), onlyStarred: v.optional(v.boolean()), search: v.optional(v.string()),
  },
  returns: v.object({ assets: v.array(galleryAssetResultValidator), cursor: v.union(v.string(), v.null()), isDone: v.boolean(), scannedCount: v.number(), order: v.literal(ORDER), includesSkillExamples: v.boolean(), includesWorkflowAssets: v.boolean() }),
  handler: async (ctx, input) => {
    const { cursor: rawCursor, pageSize: rawSize, ...filters } = input;
    const pageSize = rawSize ?? 100;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new ConvexError("pageSize must be an integer from 1 to 200.");
    const key = JSON.stringify(filters);
    const owners = resolveUserIdCandidates(input.ownerUserId);
    let state: Cursor = { v: 1, key, owner: 0, cursor: null };
    if (rawCursor) {
      try {
        const parsed = JSON.parse(rawCursor) as Cursor;
        if (parsed.v !== 1 || parsed.key !== key || !Number.isInteger(parsed.owner) || parsed.owner < 0 || parsed.owner >= owners.length || !(parsed.cursor === null || typeof parsed.cursor === "string")) throw new Error("Invalid cursor");
        state = parsed;
      } catch { throw new ConvexError("Invalid cursor or listing filters changed. Restart the listing."); }
    }
    const includesWorkflowAssets = (input.includeSkillExamples ?? input.includeWorkflowAssets) !== false;
    const args = await resolveNamedTagFilters(ctx, input);
    if (!args) return { assets: [], cursor: null, isDone: true, scannedCount: 0, order: ORDER, includesSkillExamples: includesWorkflowAssets, includesWorkflowAssets };
    let folders: Set<Id<"folders">> | undefined;
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || !canActorAccessOwnerUserId(args.ownerUserId, folder.ownerUserId)) throw new ConvexError("Collection not found.");
      folders = new Set([args.folderId]);
      if (args.includeDescendants) {
        const children = await ctx.db.query("folders").withIndex("by_parent", q => q.eq("parentFolderId", args.folderId!)).collect();
        for (const child of children) if (canActorAccessOwnerUserId(args.ownerUserId, child.ownerUserId)) folders.add(child._id);
      }
    }
    const owner = owners[state.owner];
    const query = args.onlyLiked
      ? ctx.db.query("assets").withIndex("by_owner_isLiked_createdAt", q => q.eq("ownerUserId", owner).eq("isLiked", true))
      : args.modelName
        ? ctx.db.query("assets").withIndex("by_owner_modelName_createdAt", q => q.eq("ownerUserId", owner).eq("modelName", args.modelName!))
        : args.assetRole && !isSkillExampleRole(args.assetRole)
          ? ctx.db.query("assets").withIndex("by_owner_assetRole_createdAt", q => q.eq("ownerUserId", owner).eq("assetRole", args.assetRole))
          : args.kind
            ? ctx.db.query("assets").withIndex("by_owner_kind_createdAt", q => q.eq("ownerUserId", owner).eq("kind", args.kind!))
            : ctx.db.query("assets").withIndex("by_owner_createdAt", q => q.eq("ownerUserId", owner));
    // Native Convex cursors include tie-breakers; no timestamp offsets or capped
    // scans. Empty filtered pages still carry a continuation cursor.
    const batch = await query.order("desc").paginate({ cursor: state.cursor, numItems: pageSize });
    // Resolve exclusions from this page's hydrated memberships rather than
    // loading every member of each excluded collection on every page.
    const predicate = await buildMenuFilterPredicate(ctx, { ...args, excludeFolderIds: undefined });
    const rows = batch.page.filter(asset =>
      (includesWorkflowAssets || !isHiddenSkillExample(asset, args.assetRole)) &&
      matchesMenuFilters(predicate, asset) && (!args.kind || asset.kind === args.kind) &&
      matchesAssetRole(asset.assetRole, args.assetRole) && (!args.modelName || asset.modelName === args.modelName) &&
      (!args.onlyLiked || asset.isLiked === true) && (!args.onlyStarred || Boolean(asset.starredAt)),
    );
    const hydrated = await hydrateGalleryAssetResults(ctx, rows);
    const search = args.search?.trim().toLowerCase();
    const excludedFolders = new Set(args.excludeFolderIds ?? []);
    const assets = hydrated.filter(asset => (!folders || asset.folderIds.some(id => folders.has(id))) && !asset.folderIds.some(id => excludedFolders.has(id)) && (!search || galleryAssetSearchText(asset).includes(search)));
    const isDone = batch.isDone && state.owner === owners.length - 1;
    const next: Cursor = batch.isDone ? { v: 1, key, owner: state.owner + 1, cursor: null } : { ...state, cursor: batch.continueCursor };
    return { assets, cursor: isDone ? null : JSON.stringify(next), isDone, scannedCount: batch.page.length, order: ORDER, includesSkillExamples: includesWorkflowAssets, includesWorkflowAssets };
  },
});
