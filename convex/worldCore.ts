import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";

// A world is a root collection marked with `worldKey`. Its children (style
// branches, shelves, storybooks) belong to it; nothing belongs to two worlds.
// These helpers are the one place that answers "which world is this in?", so
// every guard and the journal agree.

type Folder = Doc<"folders">;
type Ctx = QueryCtx | MutationCtx;

export const WORLD_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const worldKeyFromName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * Folder → world root lookups made during one call. A bulk filing passes one
 * memo so a hundred assets do not re-read the same shelves; never share it
 * across calls that re-parent collections.
 */
export type WorldMemo = Map<Id<"folders">, Folder | null>;

/** The world root a collection belongs to, or null when it is in no world. */
export const worldRootOfFolder = async (ctx: Ctx, folderId: Id<"folders"> | undefined, memo?: WorldMemo): Promise<Folder | null> => {
  if (!folderId) return null;
  if (memo?.has(folderId)) return memo.get(folderId)!;
  const folder = await ctx.db.get(folderId);
  const root = !folder ? null : folder.parentFolderId ? await ctx.db.get(folder.parentFolderId) : folder;
  const world = root?.worldKey ? root : null;
  memo?.set(folderId, world);
  return world;
};

export const worldIdOfFolder = async (ctx: Ctx, folderId: Id<"folders"> | undefined, memo?: WorldMemo) =>
  (await worldRootOfFolder(ctx, folderId, memo))?._id ?? null;

/** Every world a set of collections spans. */
export const worldsOfFolders = async (ctx: Ctx, folderIds: Iterable<Id<"folders"> | undefined>, memo?: WorldMemo) => {
  const worlds = new Set<Id<"folders">>();
  const seen = new Set<Id<"folders">>();
  for (const folderId of folderIds) {
    if (!folderId || seen.has(folderId)) continue;
    seen.add(folderId);
    const world = await worldIdOfFolder(ctx, folderId, memo);
    if (world) worlds.add(world);
  }
  return worlds;
};

export const assetFolderIds = async (ctx: Ctx, asset: Doc<"assets">) => {
  const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).collect();
  const ids = new Set(links.map((link) => link.folderId));
  if (asset.folderId) ids.add(asset.folderId);
  return [...ids];
};

export const worldsOfAsset = async (ctx: Ctx, asset: Doc<"assets">) =>
  worldsOfFolders(ctx, await assetFolderIds(ctx, asset));

const worldNames = async (ctx: Ctx, ids: Iterable<Id<"folders">>) => {
  const names: string[] = [];
  for (const id of ids) names.push((await ctx.db.get(id))?.name ?? id);
  return names.join(", ");
};

/**
 * Refuse a membership change that would put an asset into a second world.
 * Legacy assets already in two worlds may keep them; they can never gain one.
 */
export const assertSingleWorld = async (
  ctx: Ctx,
  asset: Doc<"assets">,
  currentFolderIds: Iterable<Id<"folders"> | undefined>,
  nextFolderIds: Iterable<Id<"folders"> | undefined>,
  memo?: WorldMemo,
) => {
  const before = await worldsOfFolders(ctx, currentFolderIds, memo);
  const after = await worldsOfFolders(ctx, nextFolderIds, memo);
  if (after.size <= 1) return;
  const gained = [...after].filter((id) => !before.has(id));
  if (gained.length === 0) return;
  throw new ConvexError(
    `asset:${asset._id} already belongs to ${await worldNames(ctx, before)}; filing it into ${await worldNames(ctx, gained)} would put it in two worlds. ` +
      "Worlds are separate: move it with world_file (move: true) or leave it where it is.",
  );
};

/** Assets linked from a world object (moodboard, story) must not live in another world. */
export const assertAssetsFitWorld = async (
  ctx: Ctx,
  worldId: Id<"folders"> | null,
  assetIds: Iterable<Id<"assets">>,
  what: string,
) => {
  if (!worldId) return;
  for (const assetId of assetIds) {
    const asset = await ctx.db.get(assetId);
    if (!asset) continue;
    const worlds = await worldsOfAsset(ctx, asset);
    if (worlds.size > 0 && !worlds.has(worldId)) {
      throw new ConvexError(
        `asset:${assetId} belongs to ${await worldNames(ctx, worlds)}, not to ${await worldNames(ctx, [worldId])}. ${what} only takes pieces of its own world (or pieces in no world, such as ART references).`,
      );
    }
  }
};

/**
 * Before a collection joins a world (brought in as a shelf, or marked as a
 * world itself), none of its pieces may already belong to another world.
 */
export const assertMembersFitWorld = async (ctx: Ctx, folderId: Id<"folders">, worldId: Id<"folders"> | null, what: string) => {
  const links = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", folderId)).take(2001);
  if (links.length > 2000) throw new ConvexError(`${what}: more than 2,000 pieces; split it first.`);
  const memo: WorldMemo = new Map();
  const clashes: string[] = [];
  for (const link of links) {
    const asset = await ctx.db.get(link.assetId);
    if (!asset) continue;
    const worlds = await worldsOfFolders(ctx, (await assetFolderIds(ctx, asset)).filter((id) => id !== folderId), memo);
    if ([...worlds].some((id) => id !== worldId)) clashes.push(`asset:${asset._id}`);
  }
  if (clashes.length > 0) {
    throw new ConvexError(`${what}: ${clashes.length} of its pieces already belong to another world (${clashes.slice(0, 5).join(", ")}${clashes.length > 5 ? " …" : ""}). Move them first with world_file.`);
  }
};

/** Resolve a world by key, name or collection id for the signed-in owner. */
export const resolveWorld = async (ctx: Ctx, owner: string, ref: string): Promise<Folder> => {
  const value = ref.trim().replace(/^(folder|collection|world):/, "");
  if (!value) throw new ConvexError("Name a world: its key (dear-annete), name or collection id.");
  const owners = resolveUserIdCandidates(owner);
  const byId = ctx.db.normalizeId("folders", value);
  if (byId) {
    const folder = await ctx.db.get(byId);
    if (folder && canActorAccessOwnerUserId(owner, folder.ownerUserId)) {
      const root = await worldRootOfFolder(ctx, folder._id);
      if (root) return root;
      throw new ConvexError(`"${folder.name}" is not in a world. Worlds: call open_world with no arguments.`);
    }
  }
  const key = worldKeyFromName(value);
  for (const candidate of owners) {
    const hit = await ctx.db.query("folders")
      .withIndex("by_owner_worldKey", (q) => q.eq("ownerUserId", candidate).eq("worldKey", key))
      .first();
    if (hit) return hit;
  }
  for (const candidate of owners) {
    const rows = await ctx.db.query("folders")
      .withIndex("by_owner_worldKey", (q) => q.eq("ownerUserId", candidate).gt("worldKey", ""))
      .collect();
    const normalized = value.toLowerCase();
    const hit = rows.find((row) => row.name.toLowerCase() === normalized)
      ?? rows.find((row) => worldKeyFromName(row.name) === key);
    if (hit) return hit;
  }
  throw new ConvexError(`No world matches "${ref}". Call open_world with no arguments for the list.`);
};

export const listWorldRoots = async (ctx: Ctx, owner: string) => {
  const rows: Folder[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("folders")
      .withIndex("by_owner_worldKey", (q) => q.eq("ownerUserId", candidate).gt("worldKey", ""))
      .collect());
  }
  return [...new Map(rows.map((row) => [row._id, row])).values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const childrenOf = async (ctx: Ctx, folderId: Id<"folders">) =>
  ctx.db.query("folders").withIndex("by_parent", (q) => q.eq("parentFolderId", folderId)).collect();

/* ── Journal ─────────────────────────────────────────────────────────────── */

export type WorldChangeOp =
  | "world.mark"
  | "doc.write"
  | "doc.delete"
  | "assets.file"
  | "shelf.create"
  | "shelf.update"
  | "moodboard.create"
  | "moodboard.update"
  | "moodboard.items"
  | "moodboard.delete"
  | "profile.save"
  | "story.save"
  | "undo";

export type JournalMeta = { actor?: string; session?: string };

const JOURNAL_TEXT_LIMIT = 400_000;

const serialize = (value: unknown) => {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text.length > JOURNAL_TEXT_LIMIT) throw new ConvexError("This change is too large to journal; split it into smaller calls.");
  return text;
};

/** Same content, ignoring revision counters (an undo bumps them). */
export const sameContent = (a: unknown, b: unknown) => JSON.stringify(stripRevisions(a)) === JSON.stringify(stripRevisions(b));
const stripRevisions = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripRevisions);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => key !== "revision" && entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stripRevisions(entry)]));
  }
  return value;
};

export const cleanSession = (value: string | undefined) => {
  const session = value?.trim().slice(0, 80);
  return session || undefined;
};

/** Write one journal entry in the same transaction as the change it records. */
/** Any session-less change is grouped by actor and hour, so it can still be read and undone as a unit. */
const autoSession = (actor: string | undefined) =>
  `auto:${(actor?.trim() || "owner").slice(0, 40)}:${new Date(Date.now()).toISOString().slice(0, 13)}`;

/**
 * Journal a membership change made by any path (the collection editor,
 * update_gallery_item, ingest with a folder). Recorded in the first world it
 * touches, in the same shape world_file uses, so world_undo can revert it.
 */
export const journalAssetMembership = async (
  ctx: MutationCtx,
  asset: Doc<"assets">,
  beforeFolderIds: Id<"folders">[],
  afterFolderIds: Id<"folders">[],
  afterPrimary: Id<"folders"> | undefined,
) => {
  const same = beforeFolderIds.length === afterFolderIds.length && beforeFolderIds.every((id) => afterFolderIds.includes(id));
  if (same) return;
  const worlds = await worldsOfFolders(ctx, [...afterFolderIds, ...beforeFolderIds]);
  const worldId = [...worlds][0];
  if (!worldId) return;
  await recordWorldChange(ctx, {
    ownerUserId: asset.ownerUserId ?? "", worldFolderId: worldId, op: "assets.file", targetType: "assets", targetId: `${worldId}:assets`,
    summary: `Refiled asset:${asset._id} in the gallery (${beforeFolderIds.length} → ${afterFolderIds.length} collections)`,
    before: [{ assetId: asset._id, folderIds: beforeFolderIds, primary: asset.folderId ?? null, tagIds: asset.tagIds }],
    after: [{ assetId: asset._id, folderIds: afterFolderIds, primary: afterPrimary ?? null, tagIds: asset.tagIds }],
    actor: "gallery",
  });
};

export const recordWorldChange = async (
  ctx: MutationCtx,
  entry: {
    ownerUserId: string;
    worldFolderId: Id<"folders">;
    op: WorldChangeOp;
    targetType: string;
    targetId: string;
    summary: string;
    before?: unknown;
    after?: unknown;
    revertOf?: Id<"worldChanges">;
  } & JournalMeta,
) =>
  ctx.db.insert("worldChanges", {
    ownerUserId: entry.ownerUserId,
    worldFolderId: entry.worldFolderId,
    op: entry.op,
    targetType: entry.targetType,
    targetId: entry.targetId,
    summary: entry.summary.slice(0, 300),
    actor: entry.actor?.trim().slice(0, 80) || "owner",
    session: cleanSession(entry.session) ?? autoSession(entry.actor),
    before: serialize(entry.before),
    after: serialize(entry.after),
    revertOf: entry.revertOf,
    createdAt: Date.now(),
  });
