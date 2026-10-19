import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  moodboardDocValidator, moodboardPreviewValidator, moodboardStatusValidator,
} from "./moodboardValidators";
import { orderChildCollections } from "../lib/collection-groups";
import {
  MOODBOARD_LIMITS, MOODBOARD_STYLE_TAG_PATTERN, cleanMidjourneyCode, cleanMidjourneyMoodboardId,
  mentionsMidjourneyTerm, moodboardSearchTerms, normalizeMoodboardName, normalizeMoodboardStyleTag,
} from "../lib/moodboards";

type Moodboard = Doc<"moodboards">;
type Folder = Doc<"folders">;

// How many prompts one code may pull from the prompt search index.
const GENERATION_SEARCH_SCAN = 256;
const MAX_CODE_HISTORY = 50;

const text = (value: string | null | undefined, max: number, label: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new ConvexError(`${label} is limited to ${max} characters.`);
  return trimmed;
};

// Optional patch fields: undefined keeps the stored value, null clears it.
const clearableText = v.optional(v.union(v.string(), v.null()));

const styleTagFrom = (value: string | null | undefined) => {
  if (!value?.trim()) return undefined;
  const tag = normalizeMoodboardStyleTag(value);
  if (!tag || tag.length > MOODBOARD_LIMITS.styleTag || !MOODBOARD_STYLE_TAG_PATTERN.test(tag)) {
    throw new ConvexError(`A style tag is a lowercase hyphenated key such as da-film (at most ${MOODBOARD_LIMITS.styleTag} characters).`);
  }
  return tag;
};

const codeFrom = (value: string | null | undefined) => {
  if (!value?.trim()) return undefined;
  const code = cleanMidjourneyCode(value);
  if (!code || /\s/.test(code) || code.length > MOODBOARD_LIMITS.mjCode) {
    throw new ConvexError(`A Midjourney code is one token such as 88ji6bg (at most ${MOODBOARD_LIMITS.mjCode} characters).`);
  }
  return code;
};

const mjMoodboardIdFrom = (value: string | null | undefined) => {
  if (!value?.trim()) return undefined;
  const id = cleanMidjourneyMoodboardId(value);
  if (!id || /\s/.test(id) || id.length > MOODBOARD_LIMITS.mjMoodboardId) {
    throw new ConvexError(`A Midjourney moodboard id is one token such as 7510337594627371941 (at most ${MOODBOARD_LIMITS.mjMoodboardId} characters).`);
  }
  return id;
};

const urlFrom = (value: string | null | undefined) => {
  const url = text(value, MOODBOARD_LIMITS.mjUrl, "The Midjourney link");
  if (!url) return undefined;
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
  } catch {
    throw new ConvexError("The Midjourney link must be an http or https URL.");
  }
  return url;
};

const requireCollection = async (ctx: QueryCtx, owner: string, folderId: Id<"folders">) => {
  const folder = await ctx.db.get(folderId);
  if (!folder || !canActorAccessOwnerUserId(owner, folder.ownerUserId)) throw new ConvexError("Collection not found.");
  if (folder.kind !== undefined) throw new ConvexError("A moodboard belongs to a plain collection, not a storybook.");
  return folder;
};

const requireAsset = async (ctx: QueryCtx, owner: string, assetId: Id<"assets">) => {
  const asset = await ctx.db.get(assetId);
  if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) throw new ConvexError(`Asset not found: asset:${assetId}`);
  return asset;
};

const requireBoard = async (ctx: QueryCtx, owner: string, moodboardId: Id<"moodboards">) => {
  const board = await ctx.db.get(moodboardId);
  if (!board || !canActorAccessOwnerUserId(owner, board.ownerUserId)) throw new ConvexError("Moodboard not found.");
  return board;
};

const findByName = async (ctx: QueryCtx, owner: string, folderId: Id<"folders">, normalizedName: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("moodboards")
      .withIndex("by_owner_folder_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("folderId", folderId).eq("normalizedName", normalizedName))
      .first();
    if (row) return row;
  }
  return null;
};

const boardsInFolder = async (ctx: QueryCtx, ownerUserIds: string[], folderId: Id<"folders">) => {
  const rows: Moodboard[] = [];
  for (const candidate of ownerUserIds) {
    rows.push(...await ctx.db.query("moodboards")
      .withIndex("by_owner_folder_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("folderId", folderId))
      .collect());
  }
  return rows;
};

const itemQuery = (ctx: QueryCtx, moodboardId: Id<"moodboards">) =>
  ctx.db.query("moodboardItems").withIndex("by_moodboard_position", (q) => q.eq("moodboardId", moodboardId));

// Every item in display order. The index already orders by position; the
// sort keeps equal positions (never written by these functions) stable.
const itemsOf = async (ctx: QueryCtx, moodboardId: Id<"moodboards">) =>
  (await itemQuery(ctx, moodboardId).collect())
    .sort((a, b) => a.position - b.position || a.addedAt - b.addedAt);

const findItem = (ctx: QueryCtx, moodboardId: Id<"moodboards">, assetId: Id<"assets">) =>
  ctx.db.query("moodboardItems")
    .withIndex("by_moodboard_asset", (q) => q.eq("moodboardId", moodboardId).eq("assetId", assetId))
    .first();

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

const previewFor = async (ctx: QueryCtx, asset: Doc<"assets">) => ({
  assetId: asset._id,
  kind: asset.kind,
  url: await resolveAssetUrl(ctx, asset),
  thumbUrl: await resolveAssetThumbUrl(ctx, asset),
  width: asset.width,
  height: asset.height,
});

// The board's face: its cover first, then the first items in order.
const previewsFor = async (ctx: QueryCtx, owner: string, board: Moodboard, limit: number) => {
  if (limit <= 0 || board.itemCount === 0) return [];
  const rows = await itemQuery(ctx, board._id).take(limit + 1);
  const ids = rows.map((row) => row.assetId);
  const ordered = board.coverAssetId
    ? [board.coverAssetId, ...ids.filter((id) => id !== board.coverAssetId)]
    : ids;
  const previews = [];
  for (const assetId of ordered.slice(0, limit)) {
    const asset = await ctx.db.get(assetId);
    if (asset && canActorAccessOwnerUserId(owner, asset.ownerUserId)) previews.push(await previewFor(ctx, asset));
  }
  return previews;
};

const moodboardRowValidator = v.object({
  ...moodboardDocValidator.fields,
  folderName: v.string(),
  // The owning collection's own parent and display group, for grouping a
  // world's boards by child collection.
  parentFolderId: v.optional(v.id("folders")),
  folderGroup: v.optional(v.string()),
  previewItems: v.array(moodboardPreviewValidator),
});

export const listMoodboards = ownerQuery({
  args: {
    ownerUserId: v.string(),
    folderId: v.optional(v.id("folders")),
    // With a root folderId: its children's boards too, child by child.
    includeChildren: v.optional(v.boolean()),
    status: v.optional(moodboardStatusValidator),
    // Archived boards are left out unless asked for by status or this flag.
    includeArchived: v.optional(v.boolean()),
    // Preview items per board, 0 to 6 (default 6). 0 reads boards only.
    previewLimit: v.optional(v.number()),
  },
  returns: v.array(moodboardRowValidator),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const ownerUserIds = resolveUserIdCandidates(owner);
    const previewLimit = Math.min(MOODBOARD_LIMITS.previews, Math.max(0, Math.floor(args.previewLimit ?? MOODBOARD_LIMITS.previews)));
    const folders = new Map<Id<"folders">, Folder>();
    const boards: Moodboard[] = [];
    if (args.folderId) {
      // A collection that is gone, foreign or a storybook holds no boards.
      const folder = await ctx.db.get(args.folderId);
      if (!folder || folder.kind !== undefined || !canActorAccessOwnerUserId(owner, folder.ownerUserId)) return [];
      const scope = [folder];
      if (args.includeChildren && folder.parentFolderId === undefined) {
        const children = await ctx.db.query("folders").withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id)).collect();
        scope.push(...orderChildCollections(children.filter((child) => child.kind === undefined && canActorAccessOwnerUserId(owner, child.ownerUserId))));
      }
      for (const entry of scope) {
        folders.set(entry._id, entry);
        boards.push(...await boardsInFolder(ctx, ownerUserIds, entry._id));
      }
    } else {
      for (const candidate of ownerUserIds) {
        boards.push(...await ctx.db.query("moodboards").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate)).order("desc").collect());
      }
    }

    const folderOrder = new Map([...folders.keys()].map((id, index) => [id, index]));
    const visible = [...new Map(boards.map((board) => [board._id, board])).values()]
      .filter((board) => args.status ? board.status === args.status : args.includeArchived || board.status !== "archived")
      .sort((a, b) => args.folderId
        ? (folderOrder.get(a.folderId) ?? 0) - (folderOrder.get(b.folderId) ?? 0) || byName(a, b)
        : b.updatedAt - a.updatedAt);

    const rows = [];
    for (const board of visible) {
      let folder = folders.get(board.folderId);
      if (!folder) {
        folder = (await ctx.db.get(board.folderId)) ?? undefined;
        if (folder) folders.set(folder._id, folder);
      }
      rows.push({
        ...board,
        folderName: folder?.name ?? "Unknown collection",
        parentFolderId: folder?.parentFolderId,
        folderGroup: folder?.parentFolderId ? folder.group : undefined,
        previewItems: await previewsFor(ctx, owner, board, previewLimit),
      });
    }
    return rows;
  },
});

const moodboardItemValidator = v.object({
  itemId: v.id("moodboardItems"),
  assetId: v.id("assets"),
  position: v.number(),
  note: v.optional(v.string()),
  addedAt: v.number(),
  kind: v.union(v.literal("image"), v.literal("video")),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  contentType: v.optional(v.string()),
  fileName: v.optional(v.string()),
  // The linked prompt's first 400 characters.
  promptText: v.optional(v.string()),
  tagNames: v.array(v.string()),
  agentDescription: v.optional(v.string()),
});

export const getMoodboard = ownerQuery({
  args: { ownerUserId: v.string(), moodboardId: v.id("moodboards") },
  returns: v.object({
    moodboard: moodboardDocValidator,
    folderName: v.string(),
    parentFolderId: v.optional(v.id("folders")),
    parentFolderName: v.optional(v.string()),
    items: v.array(moodboardItemValidator),
    // Items whose asset is gone or no longer this owner's. Left out of items.
    missingAssetIds: v.array(v.id("assets")),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const board = await requireBoard(ctx, owner, args.moodboardId);
    const folder = await ctx.db.get(board.folderId);
    const parent = folder?.parentFolderId ? await ctx.db.get(folder.parentFolderId) : null;
    const promptText = new Map<Id<"prompts">, string | undefined>();
    const tagName = new Map<Id<"tags">, string | undefined>();
    const items = [];
    const missingAssetIds: Id<"assets">[] = [];
    for (const item of await itemsOf(ctx, board._id)) {
      const asset = await ctx.db.get(item.assetId);
      if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) {
        missingAssetIds.push(item.assetId);
        continue;
      }
      if (asset.promptId && !promptText.has(asset.promptId)) {
        promptText.set(asset.promptId, (await ctx.db.get(asset.promptId))?.text?.slice(0, 400));
      }
      const tagNames: string[] = [];
      for (const tagId of asset.tagIds) {
        if (!tagName.has(tagId)) tagName.set(tagId, (await ctx.db.get(tagId))?.name);
        const name = tagName.get(tagId);
        if (name) tagNames.push(name);
      }
      items.push({
        itemId: item._id, position: item.position, note: item.note, addedAt: item.addedAt,
        ...await previewFor(ctx, asset),
        contentType: asset.contentType, fileName: asset.fileName,
        promptText: asset.promptId ? promptText.get(asset.promptId) : undefined,
        tagNames, agentDescription: asset.agentDescription,
      });
    }
    return {
      moodboard: board, folderName: folder?.name ?? "Unknown collection",
      parentFolderId: folder?.parentFolderId, parentFolderName: parent?.name,
      items, missingAssetIds,
    };
  },
});

export const listMoodboardsForAsset = ownerQuery({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.array(v.object({
    moodboardId: v.id("moodboards"), name: v.string(), folderId: v.id("folders"),
    status: moodboardStatusValidator, mjCode: v.optional(v.string()), position: v.number(),
  })),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("moodboardItems").withIndex("by_asset", (q) => q.eq("assetId", args.assetId)).collect();
    const results = [];
    for (const row of rows) {
      if (!canActorAccessOwnerUserId(args.ownerUserId, row.ownerUserId)) continue;
      const board = await ctx.db.get(row.moodboardId);
      if (!board) continue;
      results.push({ moodboardId: board._id, name: board.name, folderId: board.folderId, status: board.status, mjCode: board.mjCode, position: row.position });
    }
    return results.sort(byName);
  },
});

const writeResult = v.object({ moodboardId: v.id("moodboards"), created: v.boolean(), revision: v.number() });

export const createMoodboard = ownerMutation({
  args: {
    ownerUserId: v.string(), folderId: v.id("folders"), name: v.string(),
    description: v.optional(v.string()), styleTag: v.optional(v.string()),
    mjCode: v.optional(v.string()), mjMoodboardId: v.optional(v.string()), mjUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: writeResult,
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const folder = await requireCollection(ctx, owner, args.folderId);
    const name = text(args.name, MOODBOARD_LIMITS.name, "Name");
    if (!name) throw new ConvexError("A moodboard needs a name.");
    const fields = {
      description: text(args.description, MOODBOARD_LIMITS.description, "Description"),
      styleTag: styleTagFrom(args.styleTag),
      mjCode: codeFrom(args.mjCode),
      mjMoodboardId: mjMoodboardIdFrom(args.mjMoodboardId),
      mjUrl: urlFrom(args.mjUrl),
      notes: text(args.notes, MOODBOARD_LIMITS.notes, "Notes"),
    };
    const normalizedName = normalizeMoodboardName(name);
    const now = Date.now();
    // Same name in the same collection is the same board. A retry returns it
    // and only fills fields that are still empty; it never overwrites.
    const existing = await findByName(ctx, owner, folder._id, normalizedName);
    if (existing) {
      const fill: Partial<Moodboard> = {};
      for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
        if (fields[key] !== undefined && existing[key] === undefined) fill[key] = fields[key];
      }
      if (Object.keys(fill).length === 0) return { moodboardId: existing._id, created: false, revision: existing.revision };
      const revision = existing.revision + 1;
      const recordsMidjourney = Boolean(fill.mjCode || fill.mjMoodboardId) && existing.status === "draft";
      await ctx.db.patch(existing._id, { ...fill, ...(recordsMidjourney ? { status: "in-midjourney" as const } : {}), revision, updatedAt: now });
      return { moodboardId: existing._id, created: false, revision };
    }
    const moodboardId = await ctx.db.insert("moodboards", {
      ownerUserId: owner, folderId: folder._id, name, normalizedName, ...fields,
      // A board recorded with its Midjourney identity already lives there.
      status: fields.mjCode || fields.mjMoodboardId ? "in-midjourney" : "draft",
      itemCount: 0, revision: 1, createdAt: now, updatedAt: now,
    });
    return { moodboardId, created: true, revision: 1 };
  },
});

export const updateMoodboard = ownerMutation({
  args: {
    ownerUserId: v.string(), moodboardId: v.id("moodboards"),
    // The revision last read; a stale one is refused.
    expectedRevision: v.optional(v.number()),
    name: v.optional(v.string()), description: clearableText, styleTag: clearableText,
    status: v.optional(moodboardStatusValidator),
    // Must be an item on the board; null falls back to the first item.
    coverAssetId: v.optional(v.union(v.id("assets"), v.null())),
    notes: clearableText,
    // Move the board to another plain collection.
    folderId: v.optional(v.id("folders")),
    // Correct the recorded Midjourney identity without recording a sync. A
    // changed code still goes onto mjCodeHistory.
    mjCode: clearableText, mjMoodboardId: clearableText, mjUrl: clearableText,
  },
  returns: v.object({ moodboardId: v.id("moodboards"), revision: v.number() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const board = await requireBoard(ctx, owner, args.moodboardId);
    if (args.expectedRevision !== undefined && args.expectedRevision !== board.revision) {
      throw new ConvexError(`"${board.name}" changed (revision ${board.revision}). Reload before saving.`);
    }
    const name = args.name === undefined ? board.name : text(args.name, MOODBOARD_LIMITS.name, "Name");
    if (!name) throw new ConvexError("A moodboard needs a name.");
    const folderId = args.folderId === undefined ? board.folderId : (await requireCollection(ctx, owner, args.folderId))._id;
    const normalizedName = normalizeMoodboardName(name);
    if (normalizedName !== board.normalizedName || folderId !== board.folderId) {
      const clash = await findByName(ctx, owner, folderId, normalizedName);
      if (clash && clash._id !== board._id) throw new ConvexError(`That collection already has a moodboard named "${clash.name}".`);
    }
    let coverAssetId = board.coverAssetId;
    if (args.coverAssetId === null) {
      coverAssetId = (await itemQuery(ctx, board._id).first())?.assetId;
    } else if (args.coverAssetId !== undefined) {
      if (!await findItem(ctx, board._id, args.coverAssetId)) throw new ConvexError("The cover must be an image on this moodboard.");
      coverAssetId = args.coverAssetId;
    }
    const mjCode = args.mjCode === undefined ? board.mjCode : codeFrom(args.mjCode);
    const mjMoodboardId = args.mjMoodboardId === undefined ? board.mjMoodboardId : mjMoodboardIdFrom(args.mjMoodboardId);
    // A draft that gets its first Midjourney code or id already lives there.
    const firstIdentity = !board.mjCode && !board.mjMoodboardId && Boolean(mjCode || mjMoodboardId);
    const patch = {
      name, normalizedName, folderId, coverAssetId, mjCode, mjMoodboardId,
      description: args.description === undefined ? board.description : text(args.description, MOODBOARD_LIMITS.description, "Description"),
      styleTag: args.styleTag === undefined ? board.styleTag : styleTagFrom(args.styleTag),
      status: args.status ?? (firstIdentity && board.status === "draft" ? "in-midjourney" as const : board.status),
      notes: args.notes === undefined ? board.notes : text(args.notes, MOODBOARD_LIMITS.notes, "Notes"),
      mjUrl: args.mjUrl === undefined ? board.mjUrl : urlFrom(args.mjUrl),
    };
    const unchanged = (Object.keys(patch) as (keyof typeof patch)[]).every((key) => patch[key] === board[key]);
    if (unchanged) return { moodboardId: board._id, revision: board.revision };
    const now = Date.now();
    const mjCodeHistory = board.mjCode && mjCode !== board.mjCode
      ? [...(board.mjCodeHistory ?? []), { code: board.mjCode, at: now, note: "Edited in the gallery" }].slice(-MAX_CODE_HISTORY)
      : board.mjCodeHistory;
    const revision = board.revision + 1;
    await ctx.db.patch(board._id, { ...patch, mjCodeHistory, revision, updatedAt: now });
    return { moodboardId: board._id, revision };
  },
});

export const addMoodboardItems = ownerMutation({
  args: {
    ownerUserId: v.string(), moodboardId: v.id("moodboards"),
    // Appended in this order after the last item.
    assetIds: v.array(v.id("assets")),
    note: v.optional(v.string()),
  },
  returns: v.object({
    moodboardId: v.id("moodboards"),
    added: v.array(v.id("assets")),
    // Already on the board; left where they are.
    skipped: v.array(v.id("assets")),
    itemCount: v.number(), revision: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.assetIds.length === 0) throw new ConvexError("Supply at least one asset to add.");
    if (args.assetIds.length > MOODBOARD_LIMITS.itemsPerCall) throw new ConvexError(`Add at most ${MOODBOARD_LIMITS.itemsPerCall} assets per call.`);
    const owner = args.ownerUserId;
    const board = await requireBoard(ctx, owner, args.moodboardId);
    const note = text(args.note, MOODBOARD_LIMITS.itemNote, "Item note");
    const added: Id<"assets">[] = [];
    const skipped: Id<"assets">[] = [];
    for (const assetId of new Set(args.assetIds)) {
      await requireAsset(ctx, owner, assetId);
      if (await findItem(ctx, board._id, assetId)) skipped.push(assetId);
      else added.push(assetId);
    }
    if (added.length === 0) return { moodboardId: board._id, added, skipped, itemCount: board.itemCount, revision: board.revision };
    if (board.itemCount + added.length > MOODBOARD_LIMITS.items) {
      throw new ConvexError(`A moodboard holds at most ${MOODBOARD_LIMITS.items} images; "${board.name}" has ${board.itemCount}.`);
    }
    let position = (await itemQuery(ctx, board._id).order("desc").first())?.position ?? -1;
    const now = Date.now();
    for (const assetId of added) {
      position += 1;
      await ctx.db.insert("moodboardItems", {
        ownerUserId: board.ownerUserId, moodboardId: board._id, assetId, position,
        ...(note ? { note } : {}), addedAt: now,
      });
    }
    const itemCount = board.itemCount + added.length;
    const revision = board.revision + 1;
    await ctx.db.patch(board._id, { itemCount, coverAssetId: board.coverAssetId ?? added[0], revision, updatedAt: now });
    return { moodboardId: board._id, added, skipped, itemCount, revision };
  },
});

export const removeMoodboardItems = ownerMutation({
  args: { ownerUserId: v.string(), moodboardId: v.id("moodboards"), assetIds: v.array(v.id("assets")) },
  returns: v.object({ moodboardId: v.id("moodboards"), removed: v.number(), itemCount: v.number(), revision: v.number() }),
  handler: async (ctx, args) => {
    if (args.assetIds.length > MOODBOARD_LIMITS.itemsPerCall) throw new ConvexError(`Remove at most ${MOODBOARD_LIMITS.itemsPerCall} assets per call.`);
    const board = await requireBoard(ctx, args.ownerUserId, args.moodboardId);
    const removedIds = new Set<Id<"assets">>();
    for (const assetId of new Set(args.assetIds)) {
      const item = await findItem(ctx, board._id, assetId);
      if (!item) continue;
      await ctx.db.delete(item._id);
      removedIds.add(assetId);
    }
    if (removedIds.size === 0) return { moodboardId: board._id, removed: 0, itemCount: board.itemCount, revision: board.revision };
    const coverAssetId = board.coverAssetId && removedIds.has(board.coverAssetId)
      ? (await itemQuery(ctx, board._id).first())?.assetId
      : board.coverAssetId;
    const itemCount = Math.max(0, board.itemCount - removedIds.size);
    const revision = board.revision + 1;
    await ctx.db.patch(board._id, { itemCount, coverAssetId, revision, updatedAt: Date.now() });
    return { moodboardId: board._id, removed: removedIds.size, itemCount, revision };
  },
});

export const reorderMoodboardItems = ownerMutation({
  args: {
    ownerUserId: v.string(), moodboardId: v.id("moodboards"),
    // The full new order: every current item exactly once.
    assetIds: v.array(v.id("assets")),
  },
  returns: v.object({ moodboardId: v.id("moodboards"), moved: v.number(), revision: v.number() }),
  handler: async (ctx, args) => {
    const board = await requireBoard(ctx, args.ownerUserId, args.moodboardId);
    const items = await itemsOf(ctx, board._id);
    const byAsset = new Map(items.map((item) => [item.assetId, item]));
    if (new Set(args.assetIds).size !== args.assetIds.length) throw new ConvexError("List each item once.");
    if (args.assetIds.length !== items.length || args.assetIds.some((assetId) => !byAsset.has(assetId))) {
      throw new ConvexError(`Send the full order of the board's ${items.length} items; the set sent differs from what is on it.`);
    }
    let moved = 0;
    for (const [position, assetId] of args.assetIds.entries()) {
      const item = byAsset.get(assetId)!;
      if (item.position === position) continue;
      await ctx.db.patch(item._id, { position });
      moved += 1;
    }
    if (moved === 0) return { moodboardId: board._id, moved, revision: board.revision };
    const revision = board.revision + 1;
    await ctx.db.patch(board._id, { revision, updatedAt: Date.now() });
    return { moodboardId: board._id, moved, revision };
  },
});

export const setMoodboardMidjourney = ownerMutation({
  args: {
    ownerUserId: v.string(), moodboardId: v.id("moodboards"),
    mjCode: v.optional(v.string()), mjMoodboardId: v.optional(v.string()), mjUrl: v.optional(v.string()),
    // How many board images Midjourney now holds. Defaults to the item count.
    syncedItemCount: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.object({
    moodboardId: v.id("moodboards"), revision: v.number(), status: moodboardStatusValidator,
    mjCode: v.optional(v.string()), mjMoodboardId: v.optional(v.string()), mjSyncedAt: v.number(),
    mjSyncedItemCount: v.number(), previousCode: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const board = await requireBoard(ctx, args.ownerUserId, args.moodboardId);
    const mjCode = codeFrom(args.mjCode) ?? board.mjCode;
    const mjMoodboardId = mjMoodboardIdFrom(args.mjMoodboardId) ?? board.mjMoodboardId;
    if (!mjCode && !mjMoodboardId) throw new ConvexError("Record the Midjourney code or moodboard id of the synced board.");
    const syncedItemCount = args.syncedItemCount ?? board.itemCount;
    if (!Number.isInteger(syncedItemCount) || syncedItemCount < 0 || syncedItemCount > MOODBOARD_LIMITS.items) {
      throw new ConvexError(`syncedItemCount is a whole number from 0 to ${MOODBOARD_LIMITS.items}.`);
    }
    const note = text(args.note, MOODBOARD_LIMITS.syncNote, "Sync note");
    const now = Date.now();
    const previousCode = board.mjCode && mjCode !== board.mjCode ? board.mjCode : undefined;
    const mjCodeHistory = previousCode
      ? [...(board.mjCodeHistory ?? []), { code: previousCode, at: now, ...(note ? { note } : {}) }].slice(-MAX_CODE_HISTORY)
      : board.mjCodeHistory;
    const revision = board.revision + 1;
    await ctx.db.patch(board._id, {
      mjCode, mjMoodboardId, mjUrl: urlFrom(args.mjUrl) ?? board.mjUrl, mjCodeHistory,
      mjSyncedAt: now, mjSyncedItemCount: syncedItemCount, status: "in-midjourney", revision, updatedAt: now,
    });
    return {
      moodboardId: board._id, revision, status: "in-midjourney" as const, mjCode, mjMoodboardId,
      mjSyncedAt: now, mjSyncedItemCount: syncedItemCount, previousCode,
    };
  },
});

const deleteBoardWithItems = async (ctx: MutationCtx, board: Moodboard) => {
  const items = await itemQuery(ctx, board._id).collect();
  for (const item of items) await ctx.db.delete(item._id);
  await ctx.db.delete(board._id);
  return items.length;
};

export const deleteMoodboard = ownerMutation({
  args: { ownerUserId: v.string(), moodboardId: v.id("moodboards") },
  returns: v.object({ deleted: v.boolean(), removedItems: v.number() }),
  handler: async (ctx, args) => {
    const board = await ctx.db.get(args.moodboardId);
    if (!board) return { deleted: false, removedItems: 0 };
    if (!canActorAccessOwnerUserId(args.ownerUserId, board.ownerUserId)) throw new ConvexError("Moodboard not found.");
    // The board and its item rows go; the assets themselves are untouched.
    return { deleted: true, removedItems: await deleteBoardWithItems(ctx, board) };
  },
});

const generationValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  contentType: v.optional(v.string()),
  promptText: v.optional(v.string()),
  createdAt: v.number(),
  // The code (or m<id>) its prompt carries.
  matchedTerm: v.string(),
  onBoard: v.boolean(),
});

// "Made with this board": the owner's assets whose linked prompt carries the
// board's code, an earlier code or its m<id>. Prompt search narrows the
// candidates; a whole-token check confirms each one.
export const listMoodboardGenerations = ownerQuery({
  args: { ownerUserId: v.string(), moodboardId: v.id("moodboards"), limit: v.optional(v.number()) },
  returns: v.object({ terms: v.array(v.string()), assets: v.array(generationValidator) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const board = await requireBoard(ctx, owner, args.moodboardId);
    const limit = Math.min(MOODBOARD_LIMITS.generations, Math.max(1, Math.floor(args.limit ?? 24)));
    const terms = moodboardSearchTerms(board);
    if (terms.length === 0) return { terms, assets: [] };
    const prompts = new Map<Id<"prompts">, { term: string; text: string }>();
    for (const term of terms) {
      const hits = await ctx.db.query("prompts").withSearchIndex("search_text", (q) => q.search("text", term)).take(GENERATION_SEARCH_SCAN);
      for (const prompt of hits) {
        if (prompts.has(prompt._id) || !canActorAccessOwnerUserId(owner, prompt.ownerUserId)) continue;
        if (mentionsMidjourneyTerm(prompt.text, term)) prompts.set(prompt._id, { term, text: prompt.text });
      }
    }
    const found = new Map<Id<"assets">, { asset: Doc<"assets">; term: string; text: string }>();
    for (const [promptId, match] of prompts) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        const assets = await ctx.db.query("assets")
          .withIndex("by_owner_prompt_createdAt", (q) => q.eq("ownerUserId", candidate).eq("promptId", promptId))
          .collect();
        for (const asset of assets) found.set(asset._id, { asset, ...match });
      }
    }
    const newest = [...found.values()].sort((a, b) => b.asset.createdAt - a.asset.createdAt).slice(0, limit);
    const assets = [];
    for (const { asset, term, text: promptText } of newest) {
      assets.push({
        ...await previewFor(ctx, asset), contentType: asset.contentType,
        promptText: promptText.slice(0, 400), createdAt: asset.createdAt, matchedTerm: term,
        onBoard: Boolean(await findItem(ctx, board._id, asset._id)),
      });
    }
    return { terms, assets };
  },
});

// Asset delete cascade (assets.ts): the asset leaves every board it was on.
// Counts drop by the rows removed and a cover that named it falls back to the
// board's first item. Media is never touched here.
export const detachAssetFromMoodboards = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const rows = await ctx.db.query("moodboardItems").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect();
  const removedByBoard = new Map<Id<"moodboards">, number>();
  for (const row of rows) {
    await ctx.db.delete(row._id);
    removedByBoard.set(row.moodboardId, (removedByBoard.get(row.moodboardId) ?? 0) + 1);
  }
  for (const [moodboardId, removed] of removedByBoard) {
    const board = await ctx.db.get(moodboardId);
    if (!board) continue;
    const coverAssetId = board.coverAssetId === assetId
      ? (await itemQuery(ctx, moodboardId).first())?.assetId
      : board.coverAssetId;
    await ctx.db.patch(moodboardId, {
      itemCount: Math.max(0, board.itemCount - removed), coverAssetId,
      revision: board.revision + 1, updatedAt: Date.now(),
    });
  }
};

// A free name for a board moving into `folderId`: its own, else suffixed with
// the collection it came from, else numbered.
const freeName = async (ctx: QueryCtx, board: Moodboard, folderId: Id<"folders">, fromName: string) => {
  const candidates = [
    board.name,
    `${board.name} · ${fromName}`.slice(0, MOODBOARD_LIMITS.name),
    ...Array.from({ length: 48 }, (_, index) => `${board.name.slice(0, MOODBOARD_LIMITS.name - 6)} ${index + 2}`),
  ];
  for (const name of candidates) {
    const normalizedName = normalizeMoodboardName(name);
    const clash = await findByName(ctx, board.ownerUserId, folderId, normalizedName);
    if (!clash || clash._id === board._id) return { name, normalizedName };
  }
  const name = `${board.name.slice(0, MOODBOARD_LIMITS.name - 14)} ${Date.now()}`;
  return { name, normalizedName: normalizeMoodboardName(name) };
};

// Collection delete cascade (folders.ts, before the folder row goes): a child
// collection's boards move up to its world; a root's boards are deleted with
// their items. The assets stay either way.
export const rehomeFolderMoodboards = async (ctx: MutationCtx, folder: Folder, ownerUserIds: string[]) => {
  const boards = [...new Map((await boardsInFolder(ctx, ownerUserIds, folder._id)).map((board) => [board._id, board])).values()];
  const parent = folder.parentFolderId ? await ctx.db.get(folder.parentFolderId) : null;
  let moved = 0;
  let deleted = 0;
  for (const board of boards) {
    if (parent && parent.kind === undefined) {
      const { name, normalizedName } = await freeName(ctx, board, parent._id, folder.name);
      await ctx.db.patch(board._id, { folderId: parent._id, name, normalizedName, revision: board.revision + 1, updatedAt: Date.now() });
      moved += 1;
    } else {
      await deleteBoardWithItems(ctx, board);
      deleted += 1;
    }
  }
  return { moved, deleted };
};

