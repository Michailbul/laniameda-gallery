import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { collectAssetsForFolder } from "./assets";
import { buildR2PublicUrl, resolveAssetThumbUrl } from "./r2_url";
import { assetFolderIds, childrenOf, listWorldRoots, worldRootOfFolder, worldsOfAsset, type WorldMemo } from "./worldCore";
import { fileAssetsInWorld } from "./worlds";
import { MERGED_SHELF_GROUP, STYLE_SHELF_GROUP, profileCodesIn, worldShortName } from "../lib/world-styles";
import { addAssetToBeat, parseStorybookRecord, placeFrames } from "../lib/storybook-reader";

// What the styles page's keys act on (/w/<world>/styles): the frame's own
// recipe by name, where the frame sits, and the moves Michael makes from a
// hovered or open frame: into a collection, into a storybook beat, onto
// another style or off this one. Every filing goes through fileAssetsInWorld,
// so it is journaled and world_undo puts it back. Likes are in assets.ts
// (setAssetLikeLevel).

type Ctx = QueryCtx | MutationCtx;
type Folder = Doc<"folders">;

const ACTOR = "styles page";
const STORYBOOK_FRAMES = 120;
const MADE_WITH_SAMPLE = 40;

const owned = <T extends { ownerUserId?: string }>(owner: string, row: T | null): row is T =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId ?? ""));

const isStyleShelf = (folder: Folder) => {
  const group = folder.group?.trim().toLowerCase();
  return group === STYLE_SHELF_GROUP.toLowerCase() || group === MERGED_SHELF_GROUP.toLowerCase();
};

/* ── Names for Midjourney codes ─────────────────────────────────────────── */

const previewValidator = v.object({ assetId: v.id("assets"), thumbUrl: v.optional(v.string()) });
export type MadeWith = Infer<typeof madeWithValidator>;
const madeWithValidator = v.object({
  kind: v.union(v.literal("moodboard"), v.literal("profile"), v.literal("unknown")),
  // The Midjourney code: agents and the hover title only, never on the surface.
  code: v.string(),
  name: v.optional(v.string()),
  moodboardId: v.optional(v.id("moodboards")),
  profileId: v.optional(v.id("mjProfiles")),
  previews: v.array(previewValidator),
  // How many of the sampled frames carry it (style view only).
  frames: v.optional(v.number()),
});

const previewOf = async (ctx: Ctx, asset: Doc<"assets">) => {
  const small = (asset.thumbVariants ?? []).sort((a, b) => a.width - b.width)[0];
  return { assetId: asset._id, thumbUrl: (small ? buildR2PublicUrl(small.r2Key) : undefined) ?? await resolveAssetThumbUrl(ctx, asset) };
};

const boardPreviews = async (ctx: Ctx, owner: string, board: Doc<"moodboards">) => {
  const ids = [
    ...(board.coverAssetId ? [board.coverAssetId] : []),
    ...(await ctx.db.query("moodboardItems").withIndex("by_moodboard_position", (q) => q.eq("moodboardId", board._id)).take(4)).map((item) => item.assetId),
  ];
  const previews = [];
  for (const id of [...new Set(ids)].slice(0, 3)) {
    const asset = await ctx.db.get(id);
    if (owned(owner, asset)) previews.push(await previewOf(ctx, asset));
  }
  return previews;
};

/** Each code as the moodboard or profile the gallery knows it by, in order. */
const nameCodes = async (ctx: Ctx, owner: string, codes: string[]) => {
  const owners = resolveUserIdCandidates(owner);
  // Codes no index finds (an `m<id>` moodboard, a code a board or profile
  // had before) are matched against the owner's boards and profiles, read once.
  let known: { boards: Map<string, Doc<"moodboards">>; profiles: Map<string, Doc<"mjProfiles">> } | null = null;
  const everything = async () => {
    if (known) return known;
    known = { boards: new Map(), profiles: new Map() };
    for (const candidate of owners) {
      for (const row of await ctx.db.query("moodboards").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate)).take(500)) {
        if (row.mjMoodboardId) known.boards.set(`m${row.mjMoodboardId}`, row);
        for (const entry of row.mjCodeHistory ?? []) if (!known.boards.has(entry.code)) known.boards.set(entry.code, row);
      }
      for (const row of await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate)).take(500)) {
        for (const entry of row.codeHistory) if (!known.profiles.has(entry.code)) known.profiles.set(entry.code, row);
      }
    }
    return known;
  };
  const out = [];
  for (const code of codes) {
    let board: Doc<"moodboards"> | null = null;
    let profile: Doc<"mjProfiles"> | null = null;
    for (const candidate of owners) {
      board ??= await ctx.db.query("moodboards").withIndex("by_owner_mjCode", (q) => q.eq("ownerUserId", candidate).eq("mjCode", code)).first();
      if (!board) profile ??= await ctx.db.query("mjProfiles").withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", code)).first();
    }
    if (!board && !profile) {
      const all = await everything();
      board = all.boards.get(code) ?? all.boards.get(code.toLowerCase()) ?? null;
      if (!board) profile = all.profiles.get(code) ?? null;
    }
    if (board) out.push({ kind: "moodboard" as const, code, name: board.name, moodboardId: board._id, previews: await boardPreviews(ctx, owner, board) });
    else if (profile) out.push({ kind: "profile" as const, code, name: profile.name, profileId: profile._id, previews: [] });
    else out.push({ kind: "unknown" as const, code, previews: [] });
  }
  return out;
};

/**
 * A style's moodboards and profiles: the ones its record names, or, when it
 * names none, the codes its newest frames were made with (most used first).
 */
export const styleMadeWith = ownerQuery({
  args: { ownerUserId: v.string(), styleId: v.id("worldStyles") },
  returns: v.object({ source: v.union(v.literal("record"), v.literal("frames"), v.literal("none")), items: v.array(madeWithValidator) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const style = await ctx.db.get(args.styleId);
    if (!owned(owner, style)) throw new ConvexError("Style not found.");
    const recorded: string[] = [];
    const items: MadeWith[] = [];
    for (const recipe of style.recipes) {
      for (const id of recipe.moodboardIds) {
        const board = await ctx.db.get(id);
        if (!owned(owner, board) || items.some((item) => item.moodboardId === board._id)) continue;
        items.push({ kind: "moodboard" as const, code: board.mjCode ?? (board.mjMoodboardId ? `m${board.mjMoodboardId}` : ""), name: board.name, moodboardId: board._id, previews: await boardPreviews(ctx, owner, board) });
      }
      for (const id of recipe.profileIds) {
        const profile = await ctx.db.get(id);
        if (!owned(owner, profile) || items.some((item) => item.profileId === profile._id)) continue;
        items.push({ kind: "profile" as const, code: profile.code, name: profile.name, profileId: profile._id, previews: [] });
      }
      for (const code of recipe.unknownCodes ?? []) if (!recorded.includes(code)) recorded.push(code);
    }
    if (items.length || recorded.length) {
      // A code the record could not name may be a board's or profile's older code.
      for (const item of await nameCodes(ctx, owner, recorded)) {
        if (item.kind === "unknown" || !items.some((row) => (item.moodboardId && row.moodboardId === item.moodboardId) || (item.profileId && row.profileId === item.profileId))) items.push(item);
      }
      return { source: "record" as const, items };
    }
    if (!style.shelfFolderId) return { source: "none" as const, items: [] };
    const links = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", style.shelfFolderId!))
      .order("desc").take(MADE_WITH_SAMPLE);
    const counts = new Map<string, number>();
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (!owned(owner, asset) || !asset.promptId) continue;
      for (const code of profileCodesIn((await ctx.db.get(asset.promptId))?.text)) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const codes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code]) => code);
    if (!codes.length) return { source: "none" as const, items: [] };
    const named = await nameCodes(ctx, owner, codes);
    return { source: "frames" as const, items: named.map((item) => ({ ...item, frames: counts.get(item.code) })) };
  },
});

/* ── One frame, as the open view shows it ───────────────────────────────── */

const placeValidator = v.object({
  id: v.id("folders"), name: v.string(),
  kind: v.union(v.literal("world"), v.literal("style"), v.literal("storybook"), v.literal("collection")),
  styleId: v.optional(v.id("worldStyles")),
});

export const getFrameView = ownerQuery({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.union(v.null(), v.object({
    assetId: v.id("assets"),
    prompt: v.optional(v.string()),
    madeWith: v.array(madeWithValidator),
    modelName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    createdAt: v.number(),
    liked: v.boolean(),
    superLiked: v.boolean(),
    world: v.optional(v.object({ id: v.id("folders"), key: v.string(), name: v.string() })),
    places: v.array(placeValidator),
  })),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const asset = await ctx.db.get(args.assetId);
    if (!owned(owner, asset)) return null;
    const prompt = asset.promptId ? (await ctx.db.get(asset.promptId))?.text : undefined;
    const memo: WorldMemo = new Map();
    let world: Folder | null = null;
    const places = [];
    for (const id of await assetFolderIds(ctx, asset)) {
      const folder = await ctx.db.get(id);
      if (!owned(owner, folder)) continue;
      world ??= await worldRootOfFolder(ctx, folder._id, memo);
      if (folder.worldKey && !folder.parentFolderId) { places.push({ id: folder._id, name: folder.name, kind: "world" as const }); continue; }
      if (folder.kind === "storybook") { places.push({ id: folder._id, name: folder.name, kind: "storybook" as const }); continue; }
      if (isStyleShelf(folder)) {
        const style = await ctx.db.query("worldStyles").withIndex("by_owner_shelf", (q) => q.eq("ownerUserId", folder.ownerUserId ?? owner).eq("shelfFolderId", folder._id)).first();
        places.push({ id: folder._id, name: style?.name ?? folder.name, kind: "style" as const, ...(style ? { styleId: style._id } : {}) });
        continue;
      }
      places.push({ id: folder._id, name: folder.name, kind: "collection" as const });
    }
    return {
      assetId: asset._id, prompt, madeWith: await nameCodes(ctx, owner, profileCodesIn(prompt)),
      modelName: asset.modelName, sourceUrl: asset.sourceUrl, createdAt: asset.createdAt,
      liked: Boolean(asset.isLiked), superLiked: Boolean(asset.superLikedAt),
      world: world?.worldKey ? { id: world._id, key: world.worldKey, name: world.name } : undefined,
      places,
    };
  },
});

/* ── Where a frame can go ───────────────────────────────────────────────── */

/**
 * The collections and storybooks of a universe's worlds, for the move
 * palettes (M, B). Loaded when a palette opens, never with the page.
 */
export const frameTargets = ownerQuery({
  args: { ownerUserId: v.string(), worldIds: v.array(v.id("folders")) },
  returns: v.object({
    collections: v.array(v.object({ id: v.id("folders"), name: v.string(), worldId: v.id("folders"), world: v.string(), count: v.number(), root: v.boolean() })),
    storybooks: v.array(v.object({ id: v.id("folders"), name: v.string(), worldId: v.id("folders"), world: v.string(), count: v.number() })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const roots = await listWorldRoots(ctx, owner);
    const worlds = args.worldIds.slice(0, 12).map((id) => roots.find((root) => root._id === id)).filter((row): row is Folder => Boolean(row));
    const head = worlds[0];
    const universeName = head?.universeRootId ? (roots.find((root) => root._id === head.universeRootId)?.name ?? head.name) : head?.name ?? "";
    const collections = [];
    const storybooks = [];
    for (const world of worlds) {
      const short = worldShortName(world.name, universeName);
      collections.push({ id: world._id, name: world.name, worldId: world._id, world: short, count: world.memberCount ?? 0, root: true });
      for (const child of await childrenOf(ctx, world._id)) {
        if (!owned(owner, child)) continue;
        if (child.kind === "storybook") storybooks.push({ id: child._id, name: child.name, worldId: world._id, world: short, count: child.memberCount ?? 0 });
        else if (!isStyleShelf(child)) collections.push({ id: child._id, name: child.name, worldId: world._id, world: short, count: child.memberCount ?? 0, root: false });
      }
    }
    return { collections, storybooks };
  },
});

const scriptOf = async (ctx: Ctx, owner: string, book: Folder) => {
  if (!book.parentFolderId) return null;
  for (const candidate of resolveUserIdCandidates(owner)) {
    for (const folderId of [book._id, book.parentFolderId]) {
      const rows = await ctx.db.query("stories")
        .withIndex("by_owner_folder_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("folderId", folderId)).order("desc").take(200);
      const hit = rows.find((row) => row.kind === "script" && row.storybookId === book._id);
      if (hit) return hit;
    }
  }
  return null;
};

const modelOf = async (ctx: Ctx, owner: string, book: Folder, description = book.description) => {
  const script = await scriptOf(ctx, owner, book);
  return parseStorybookRecord({
    name: book.name, description,
    script: script ? { title: script.title, logline: script.logline, hook: script.hook, body: script.body, assetIds: script.assetIds, styleTag: script.styleTag } : null,
  });
};

/** A storybook's beats, for the beat step of the B palette. */
export const storybookBeats = ownerQuery({
  args: { ownerUserId: v.string(), storybookId: v.id("folders") },
  returns: v.array(v.object({ number: v.number(), text: v.string(), frames: v.number() })),
  handler: async (ctx, args) => {
    const book = await ctx.db.get(args.storybookId);
    if (!owned(args.ownerUserId, book) || book.kind !== "storybook") throw new ConvexError("Storybook not found.");
    const model = await modelOf(ctx, args.ownerUserId, book);
    return model.beats.map((beat) => ({ number: beat.number, text: beat.text.replace(/\basset:[a-z0-9]+\b/g, "").replace(/\s+/g, " ").trim().slice(0, 140), frames: beat.assetIds.length }));
  },
});

/* ── Moves ───────────────────────────────────────────────────────────────── */

const readFrame = async (ctx: MutationCtx, owner: string, assetId: Id<"assets">) => {
  const asset = await ctx.db.get(assetId);
  if (!owned(owner, asset)) throw new ConvexError("Frame not found.");
  return asset;
};

const worldOf = async (ctx: MutationCtx, folderId: Id<"folders">) => {
  const world = await worldRootOfFolder(ctx, folderId);
  if (!world?.worldKey) throw new ConvexError("That collection is in no world.");
  return world;
};

/** True when the frame sits in a world other than `worldId` (a move takes it out of that one). */
const livesElsewhere = async (ctx: MutationCtx, asset: Doc<"assets">, worldId: Id<"folders">) =>
  [...await worldsOfAsset(ctx, asset)].some((id) => id !== worldId);

/**
 * The record with the frame tied to `beat`. When the book's frames still take
 * their beats in shelf order (no frame tied yet), those ties are written first,
 * so adding one tie does not unplace the others.
 */
const recordWithBeat = async (ctx: MutationCtx, owner: string, book: Folder, assetId: Id<"assets">, beat: number) => {
  const model = await modelOf(ctx, owner, book);
  if (!model.beats.some((entry) => entry.number === beat)) throw new ConvexError(`${book.name} has no beat ${beat}.`);
  let record = book.description ?? "";
  const members = await collectAssetsForFolder(ctx, resolveUserIdCandidates(owner), book._id, STORYBOOK_FRAMES);
  const frames = members.filter((row) => row._id !== assetId).map((row) => ({
    id: row._id as string,
    notes: [row.agentDescription, row.description, row.fileName].filter(Boolean).join("\n"),
    tagNames: [] as string[],
  }));
  const tied = model.beats.some((entry) => entry.assetIds.length > 0)
    || frames.some((frame) => /\bbeats?\s*\d{1,2}\b/i.test(frame.notes));
  if (!tied) {
    for (const [number, placed] of placeFrames(model, frames).byBeat) {
      for (const frame of placed) record = addAssetToBeat(record, number, frame.id);
    }
  }
  record = addAssetToBeat(record, beat, assetId);
  const after = await modelOf(ctx, owner, book, record);
  return after.beats.find((entry) => entry.number === beat)?.assetIds.includes(assetId) ? record : null;
};

/**
 * Puts a frame into a collection or storybook (and a beat of it). A target in
 * another world moves the frame there; within its world the frame keeps its
 * style and its other collections.
 */
export const placeFrame = ownerMutation({
  args: { ownerUserId: v.string(), assetId: v.id("assets"), folderId: v.id("folders"), beat: v.optional(v.number()), session: v.optional(v.string()) },
  returns: v.object({
    name: v.string(), world: v.string(), moved: v.boolean(), changed: v.boolean(),
    beat: v.optional(v.number()), beatTied: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const asset = await readFrame(ctx, owner, args.assetId);
    const folder = await ctx.db.get(args.folderId);
    if (!owned(owner, folder)) throw new ConvexError("Collection not found.");
    if (isStyleShelf(folder)) throw new ConvexError("That is a style's shelf: change the style with S.");
    const world = await worldOf(ctx, folder._id);
    const moved = await livesElsewhere(ctx, asset, world._id);
    const filed = await fileAssetsInWorld(ctx, {
      ownerUserId: owner, world: world.worldKey!, assetIds: [asset._id],
      addTo: [folder._id === world._id ? "root" : folder._id], move: moved,
      note: `Into ${folder.name} from the styles page`, actor: ACTOR, session: args.session,
    });
    let beatTied = false;
    if (args.beat !== undefined && folder.kind === "storybook") {
      const current = await ctx.db.get(folder._id);
      const record = current ? await recordWithBeat(ctx, owner, current, asset._id, args.beat) : null;
      if (record !== null && current && record !== (current.description ?? "")) {
        await ctx.db.patch(current._id, { description: record, updatedAt: Date.now() });
      }
      beatTied = record !== null;
    }
    return { name: folder.name, world: world.name, moved, changed: filed.changed > 0, beat: args.beat, beatTied };
  },
});

/**
 * Changes a frame's style. `to` files it on that style's shelf (moving it to
 * the style's world when that is another one) and takes it off `from`.
 * Without `to` the frame leaves `from` and stays in its world (key 2).
 */
export const setFrameStyle = ownerMutation({
  args: {
    ownerUserId: v.string(), assetId: v.id("assets"),
    from: v.optional(v.id("worldStyles")), to: v.optional(v.id("worldStyles")),
    session: v.optional(v.string()),
  },
  returns: v.object({ style: v.optional(v.string()), world: v.string(), moved: v.boolean(), changed: v.boolean() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const asset = await readFrame(ctx, owner, args.assetId);
    const from = args.from ? await ctx.db.get(args.from) : null;
    const to = args.to ? await ctx.db.get(args.to) : null;
    if (args.from && !owned(owner, from)) throw new ConvexError("Style not found.");
    if (args.to && !owned(owner, to)) throw new ConvexError("Style not found.");
    if (!from && !to) throw new ConvexError("Name the style to take the frame off, or the one to put it on.");
    const fromShelf = from?.shelfFolderId;
    if (to) {
      if (!to.shelfFolderId) throw new ConvexError(`${to.name} has no shelf for frames yet.`);
      const world = await worldOf(ctx, to.shelfFolderId);
      const moved = await livesElsewhere(ctx, asset, world._id);
      const sameWorld = from && from.worldFolderId === world._id && fromShelf && fromShelf !== to.shelfFolderId;
      const filed = await fileAssetsInWorld(ctx, {
        ownerUserId: owner, world: world.worldKey!, assetIds: [asset._id],
        addTo: [to.shelfFolderId], ...(sameWorld ? { removeFrom: [fromShelf] } : {}), move: moved,
        note: `Style ${from ? `${from.name} → ` : ""}${to.name} from the styles page`, actor: ACTOR, session: args.session,
      });
      return { style: to.name, world: world.name, moved, changed: filed.changed > 0 };
    }
    if (!fromShelf) throw new ConvexError(`${from!.name} has no shelf, so no frame is filed on it.`);
    const world = await worldOf(ctx, fromShelf);
    const memo: WorldMemo = new Map();
    let elsewhere = false;
    for (const id of await assetFolderIds(ctx, asset)) {
      if (id === fromShelf) continue;
      if ((await worldRootOfFolder(ctx, id, memo))?._id === world._id) { elsewhere = true; break; }
    }
    const filed = await fileAssetsInWorld(ctx, {
      ownerUserId: owner, world: world.worldKey!, assetIds: [asset._id],
      removeFrom: [fromShelf], ...(elsewhere ? {} : { addTo: ["root"] }),
      note: `Off the style ${from!.name} from the styles page`, actor: ACTOR, session: args.session,
    });
    return { world: world.name, moved: false, changed: filed.changed > 0 };
  },
});
