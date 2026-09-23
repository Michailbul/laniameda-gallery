import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveUserIdCandidates } from "./authz";
import { cascadeDeleteFolder } from "./folders";
import { recountFolderMembers } from "./folderHelpers";
import {
  bumpTagUsage,
  canonicalTagKey,
  findTagIdsByCanonicalKeys,
  normalizeTagName,
} from "./helpers";
import {
  normalizeCollectionSection,
  sectionKeyForTagName,
  type CollectionSectionKey,
} from "../lib/collection-sections";

// Sections are tags, not sub-collections.
//
// A collection used to carry its statics as nested "Characters" / "Locations"
// / "Scenes" / "Inspirations" sub-collections. That structure is retired: the
// piece's tag says what it is, and the island bar's tag pills filter any
// collection by it. This migration flattens the old shape —
//
//   - a section-named sub-collection ("Characters", "ANDROMEDA — Locations"):
//     every member is filed into the parent (if it wasn't already), tagged
//     with the section's singular tag, and the sub-collection is deleted
//   - "BulkTest …" / "BulkNew …" root collections left over from the bulk
//     upload smoke tests: deleted (assets stay in the library)
//
// Every other sub-collection is the owner's own folder ("Balcony", "Dari",
// an empty "inspo") and is never touched. An earlier version also folded
// non-section folders into their parent; that wiped 31 real folders on
// 23 Sep 2026 and they had to be restored from a snapshot.
//
// Idempotent: a second run finds nothing to do. `dryRun` (the default) only
// reports.

const TAG_BY_SECTION: Record<CollectionSectionKey, string> = {
  characters: "character",
  locations: "location",
  scenes: "scene",
  inspirations: "inspiration",
};

const BULK_NAME = /^bulk(test|new)\b/i;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "ANDROMEDA — Characters" under ANDROMEDA reads as "Characters"; so does
// "ORPHEUS — Characters" under "ORPHEUS — Project" — any "<prefix> — " goes.
const sectionForChild = (
  child: Doc<"folders">,
  parent: Doc<"folders">,
): CollectionSectionKey | null => {
  const candidates = [
    child.name,
    child.name.replace(
      new RegExp(`^${escapeRegExp(parent.name)}\\s*[—–-]\\s*`, "i"),
      "",
    ),
    child.name.replace(/^.*\s[—–]\s/, ""),
  ];
  for (const candidate of candidates) {
    const stripped = candidate.trim();
    const key =
      normalizeCollectionSection(stripped) ?? sectionKeyForTagName(stripped);
    if (key) return key;
  }
  return null;
};

// A folder's members: assetFolders links plus the legacy assets.folderId
// pointer, deduped.
const memberAssetsOf = async (
  ctx: MutationCtx,
  ownerUserIds: string[],
  folderId: Id<"folders">,
) => {
  const byId = new Map<Id<"assets">, Doc<"assets">>();
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_folder_createdAt", (q) =>
      q.eq("folderId", folderId).gte("createdAt", 0),
    )
    .collect();
  for (const link of links) {
    const asset = await ctx.db.get(link.assetId);
    if (asset) byId.set(asset._id, asset);
  }
  for (const ownerUserId of ownerUserIds) {
    const legacy = await ctx.db
      .query("assets")
      .withIndex("by_owner_folder_createdAt", (q) =>
        q
          .eq("ownerUserId", ownerUserId)
          .eq("folderId", folderId)
          .gte("createdAt", 0),
      )
      .collect();
    for (const asset of legacy) byId.set(asset._id, asset);
  }
  return Array.from(byId.values());
};

const resolveTagId = async (
  ctx: MutationCtx,
  name: string,
  dryRun: boolean,
): Promise<Id<"tags"> | null> => {
  const key = canonicalTagKey(name);
  const found = (await findTagIdsByCanonicalKeys(ctx, [key])).get(key);
  if (found && found.length > 0) return found[0];
  if (dryRun) return null;
  return await ctx.db.insert("tags", {
    name,
    normalized: normalizeTagName(name),
    canonicalKey: key,
    usageCount: 0,
  });
};

const reportEntryValidator = v.object({
  folderId: v.id("folders"),
  name: v.string(),
  parent: v.optional(v.string()),
  action: v.union(
    v.literal("delete-bulk"),
    v.literal("flatten"),
  ),
  assets: v.number(),
  tag: v.optional(v.string()),
  linkedToParent: v.optional(v.number()),
  tagged: v.optional(v.number()),
});

export const flattenSectionCollections = internalMutation({
  args: {
    ownerUserId: v.string(),
    /** Report only (default). Pass false to apply. */
    dryRun: v.optional(v.boolean()),
    /** Restrict the pass to these folders — lets a big vault run in chunks. */
    folderIds: v.optional(v.array(v.id("folders"))),
  },
  returns: v.object({
    dryRun: v.boolean(),
    report: v.array(reportEntryValidator),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const ownerUserIds = resolveUserIdCandidates(args.ownerUserId.trim());
    const only = args.folderIds ? new Set(args.folderIds) : null;

    const folders: Doc<"folders">[] = [];
    for (const ownerUserId of ownerUserIds) {
      folders.push(
        ...(await ctx.db
          .query("folders")
          .withIndex("by_owner_normalizedName", (q) =>
            q.eq("ownerUserId", ownerUserId),
          )
          .collect()),
      );
    }
    const byId = new Map(folders.map((folder) => [folder._id, folder]));

    const report: Array<typeof reportEntryValidator.type> = [];
    const touchedParents = new Set<Id<"folders">>();
    const usageDelta = new Map<Id<"tags">, number>();
    const now = Date.now();

    for (const folder of folders) {
      if (only && !only.has(folder._id)) continue;

      if (!folder.parentFolderId && BULK_NAME.test(folder.name)) {
        const members = await memberAssetsOf(ctx, ownerUserIds, folder._id);
        report.push({
          folderId: folder._id,
          name: folder.name,
          action: "delete-bulk",
          assets: members.length,
        });
        if (!dryRun) await cascadeDeleteFolder(ctx, folder._id, ownerUserIds);
        continue;
      }

      // Only plain sub-collections of plain collections.
      if (folder.kind !== undefined || !folder.parentFolderId) continue;
      const parent = byId.get(folder.parentFolderId);
      if (!parent || parent.kind !== undefined) continue;

      // Only section-named folders are sections. Anything else is the
      // owner's own folder and stays exactly as it is.
      const section = sectionForChild(folder, parent);
      if (!section) continue;
      const members = await memberAssetsOf(ctx, ownerUserIds, folder._id);
      const tagName = TAG_BY_SECTION[section];
      const tagId = tagName ? await resolveTagId(ctx, tagName, dryRun) : null;
      let linkedToParent = 0;
      let tagged = 0;

      for (const asset of members) {
        const existing = await ctx.db
          .query("assetFolders")
          .withIndex("by_asset_folder", (q) =>
            q.eq("assetId", asset._id).eq("folderId", parent._id),
          )
          .first();
        if (!existing) {
          linkedToParent += 1;
          if (!dryRun) {
            await ctx.db.insert("assetFolders", {
              ownerUserId: parent.ownerUserId ?? args.ownerUserId,
              assetId: asset._id,
              folderId: parent._id,
              createdAt: now,
            });
          }
        }
        if (asset.folderId === folder._id && !dryRun) {
          await ctx.db.patch(asset._id, { folderId: parent._id });
        }
        if (tagName && !(tagId && asset.tagIds.includes(tagId))) {
          tagged += 1;
          if (!dryRun && tagId) {
            await ctx.db.patch(asset._id, { tagIds: [...asset.tagIds, tagId] });
            await ctx.db.insert("assetTags", {
              assetId: asset._id,
              tagId,
              createdAt: asset.createdAt,
            });
            usageDelta.set(tagId, (usageDelta.get(tagId) ?? 0) + 1);
          }
        }
      }

      report.push({
        folderId: folder._id,
        name: folder.name,
        parent: parent.name,
        action: "flatten",
        assets: members.length,
        tag: tagName,
        linkedToParent,
        tagged,
      });
      touchedParents.add(parent._id);
      if (!dryRun) await cascadeDeleteFolder(ctx, folder._id, ownerUserIds);
    }

    if (!dryRun) {
      for (const [tagId, delta] of usageDelta) {
        await bumpTagUsage(ctx, [tagId], delta);
      }
      await recountFolderMembers(ctx, touchedParents);
    }
    return { dryRun, report };
  },
});

