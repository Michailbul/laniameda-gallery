import { ConvexError, v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { normalizeFolderName } from "./folderHelpers";
import { buildR2PublicUrl, resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  assertAssetsFitWorld, assertNameFree, assetFolderIds, childrenOf, cleanSession, listWorldRoots, recordWorldChange,
  resolveWorld, sameContent, scopedName, shelfState, worldRootOfFolder, type JournalMeta, type WorldMemo,
} from "./worldCore";
import { worldStyleRecipeValidator, worldStyleStatusValidator } from "./worldStyleValidators";
import { profileFlagForCode, profileFlagForMoodboardId } from "../lib/moodboards";
import {
  MERGED_SHELF_GROUP, STYLE_LIMITS, STYLE_SHELF_GROUP, mjFilePrefix, mjIdentityOf, mjMatches, mjSourcePrefixes,
  parseLookupQuery, recipeLabel, styleSlug, worldShortName,
} from "../lib/world-styles";

// A world's named styles, the universe they read in, the frames of each, and
// "is this frame in the gallery?" for local boards. Frames are the members of
// a style's shelf, so filing goes through world_file and is journaled there;
// every write here is journaled too (style.save, style.merge, world.universe)
// and world_undo puts it back (convex/worlds.ts revertChange).

type Style = Doc<"worldStyles">;
type Folder = Doc<"folders">;
type Ctx = QueryCtx | MutationCtx;
type Recipe = Infer<typeof worldStyleRecipeValidator>;

const journalArgs = { actor: v.optional(v.string()), session: v.optional(v.string()) };
const meta = (args: JournalMeta): JournalMeta => ({ actor: args.actor, session: cleanSession(args.session) });

const owned = <T extends { ownerUserId?: string }>(owner: string, row: T | null): row is T =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId ?? ""));

const clip = (value: string | null | undefined, max: number, label: string) => {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.length > max) throw new ConvexError(`${label} is limited to ${max} characters.`);
  return text;
};
const clipList = (values: string[] | undefined, label: string) => {
  const list = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (list.length > STYLE_LIMITS.listItems) throw new ConvexError(`${label}: at most ${STYLE_LIMITS.listItems} lines.`);
  for (const line of list) if (line.length > STYLE_LIMITS.listItem) throw new ConvexError(`${label}: a line is limited to ${STYLE_LIMITS.listItem} characters.`);
  return list;
};

/* ── Reads shared by the page and the agent tools ───────────────────────── */

const frameValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  thumbUrl: v.optional(v.string()),
  url: v.optional(v.string()),
  variants: v.optional(v.array(v.object({ url: v.string(), width: v.number() }))),
  thumbWidth: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  // Agents only (withPrompts): the first 300 characters of its prompt.
  prompt: v.optional(v.string()),
});
type Frame = Infer<typeof frameValidator>;

// Only what a tile draws: the renditions for srcset, the original for the
// open view, and the size so the grid reserves the frame before it lands.
const frameOf = async (ctx: Ctx, asset: Doc<"assets">): Promise<Frame> => {
  const variants = (asset.thumbVariants ?? [])
    .map((variant) => ({ url: buildR2PublicUrl(variant.r2Key), width: variant.width }))
    .filter((variant): variant is { url: string; width: number } => Boolean(variant.url));
  return {
    assetId: asset._id, kind: asset.kind,
    thumbUrl: await resolveAssetThumbUrl(ctx, asset), url: await resolveAssetUrl(ctx, asset),
    ...(variants.length ? { variants } : {}),
    thumbWidth: asset.thumbWidth, width: asset.width, height: asset.height,
  };
};

const universeOf = async (ctx: Ctx, owner: string, root: Folder) => {
  const head = root.universeRootId ? await ctx.db.get(root.universeRootId) : null;
  const universe = head && owned(owner, head) && head.worldKey ? head : root;
  const roots = await listWorldRoots(ctx, owner);
  const members = roots.filter((row) => row._id !== universe._id && row.universeRootId === universe._id);
  return { universe, worlds: [universe, ...members] };
};

const stylesOfWorld = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const rows: Style[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("worldStyles")
      .withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId)).collect());
  }
  return rows.sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
};

/** Its cover frames, then the shelf's newest frames, up to `limit`. */
const coversOf = async (ctx: Ctx, owner: string, style: Style, limit: number) => {
  const frames: Frame[] = [];
  const seen = new Set<Id<"assets">>();
  for (const assetId of style.coverAssetIds) {
    if (frames.length >= limit) break;
    const asset = await ctx.db.get(assetId);
    if (!owned(owner, asset) || seen.has(asset._id)) continue;
    seen.add(asset._id);
    frames.push(await frameOf(ctx, asset));
  }
  if (frames.length < limit && style.shelfFolderId) {
    const links = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", style.shelfFolderId!))
      .order("desc").take(limit * 2);
    for (const link of links) {
      if (frames.length >= limit) break;
      if (seen.has(link.assetId)) continue;
      const asset = await ctx.db.get(link.assetId);
      if (!owned(owner, asset)) continue;
      seen.add(asset._id);
      frames.push(await frameOf(ctx, asset));
    }
  }
  return frames;
};

/** Recipe names in stack order, from the linked boards and profiles. */
const recipeNames = async (ctx: Ctx, recipe: Recipe) => {
  const names: string[] = [];
  for (const id of recipe.moodboardIds) names.push((await ctx.db.get(id))?.name ?? "missing moodboard");
  for (const id of recipe.profileIds) names.push((await ctx.db.get(id))?.name ?? "missing profile");
  for (const _code of recipe.unknownCodes ?? []) names.push("unnamed profile");
  return names;
};

const styleCardValidator = v.object({
  id: v.id("worldStyles"), name: v.string(), slug: v.string(), line: v.optional(v.string()),
  family: v.string(), status: worldStyleStatusValidator,
  world: v.object({ id: v.id("folders"), key: v.string(), name: v.string(), short: v.string() }),
  shelfId: v.optional(v.id("folders")), frameCount: v.number(),
  covers: v.array(frameValidator),
  recipe: v.optional(v.string()), recipeCount: v.number(), hasLock: v.boolean(),
  mergedIntoStyleId: v.optional(v.id("worldStyles")),
  sortOrder: v.optional(v.number()), revision: v.number(), updatedAt: v.number(),
});

export const listStyles = ownerQuery({
  args: {
    ownerUserId: v.string(), world: v.string(),
    // Default true: every world of the universe. false: this world only.
    universe: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
    coverLimit: v.optional(v.number()),
  },
  returns: v.object({
    universe: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }),
    world: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }),
    worlds: v.array(v.object({ id: v.id("folders"), key: v.string(), name: v.string(), short: v.string(), styleCount: v.number() })),
    styles: v.array(styleCardValidator),
    // Shelves in the group Styles that no style record names yet (agents adopt them with save_style).
    unrecordedShelves: v.array(v.object({ id: v.id("folders"), name: v.string(), worldKey: v.string(), count: v.number() })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const { universe, worlds: all } = await universeOf(ctx, owner, root);
    const worlds = args.universe === false ? [root] : all;
    const coverLimit = Math.min(Math.max(args.coverLimit ?? 4, 0), 6);
    const styles = [];
    const worldRows = [];
    const unrecordedShelves = [];
    for (const world of worlds) {
      const short = worldShortName(world.name, universe.name);
      const every = await stylesOfWorld(ctx, owner, world._id);
      const rows = every.filter((style) => args.includeArchived || (style.status !== "archived" && style.status !== "merged"));
      const children = (await childrenOf(ctx, world._id)).filter((child) => owned(owner, child));
      const recorded = new Set(every.map((style) => style.shelfFolderId).filter(Boolean));
      for (const child of children) {
        if (child.kind || child.group?.trim().toLowerCase() !== "styles" || recorded.has(child._id)) continue;
        unrecordedShelves.push({ id: child._id, name: child.name, worldKey: world.worldKey!, count: child.memberCount ?? 0 });
      }
      const shelfCount = new Map(children.map((child) => [child._id, child.memberCount ?? 0]));
      for (const style of rows) {
        const first = style.recipes[0];
        styles.push({
          id: style._id, name: style.name, slug: style.slug, line: style.line,
          family: style.family ?? short, status: style.status,
          world: { id: world._id, key: world.worldKey!, name: world.name, short },
          shelfId: style.shelfFolderId,
          frameCount: style.shelfFolderId ? shelfCount.get(style.shelfFolderId) ?? 0 : style.coverAssetIds.length,
          covers: coverLimit ? await coversOf(ctx, owner, style, coverLimit) : [],
          recipe: first ? recipeLabel(await recipeNames(ctx, first)) || undefined : undefined,
          recipeCount: style.recipes.length, hasLock: Boolean(style.lockStoryId),
          mergedIntoStyleId: style.mergedIntoStyleId,
          sortOrder: style.sortOrder, revision: style.revision, updatedAt: style.updatedAt,
        });
      }
      worldRows.push({ id: world._id, key: world.worldKey!, name: world.name, short, styleCount: rows.length });
    }
    return {
      universe: { id: universe._id, key: universe.worldKey!, name: universe.name },
      world: { id: root._id, key: root.worldKey!, name: root.name },
      worlds: worldRows, styles, unrecordedShelves,
    };
  },
});

/** A style by id, or by slug or name inside a world (or its universe). */
const resolveStyle = async (ctx: Ctx, owner: string, ref: string, world?: string): Promise<Style> => {
  const value = ref.trim().replace(/^style:/, "");
  if (!value) throw new ConvexError("Name a style: style:<id>, or its name with world.");
  const byId = ctx.db.normalizeId("worldStyles", value);
  if (byId) {
    const row = await ctx.db.get(byId);
    if (owned(owner, row)) return row;
  }
  if (!world) throw new ConvexError(`"${ref}" is not a style id. Give world too, to find a style by its name.`);
  const root = await resolveWorld(ctx, owner, world);
  const { worlds } = await universeOf(ctx, owner, root);
  const slug = styleSlug(value);
  const ordered = [root, ...worlds.filter((row) => row._id !== root._id)];
  for (const row of ordered) {
    for (const candidate of resolveUserIdCandidates(owner)) {
      const hit = await ctx.db.query("worldStyles")
        .withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", row._id).eq("slug", slug)).first();
      if (hit) return hit;
    }
  }
  throw new ConvexError(`No style "${ref}" in ${root.name} or its universe. list_styles shows them.`);
};

const boardRefValidator = v.object({
  id: v.id("moodboards"), name: v.string(), status: v.string(), itemCount: v.number(),
  mjCode: v.optional(v.string()), profileFlag: v.optional(v.string()),
  // Set when the board lives in another world than the style.
  otherWorld: v.optional(v.string()),
  previews: v.array(frameValidator),
});
const profileRefValidator = v.object({
  id: v.id("mjProfiles"), name: v.string(), code: v.string(), flag: v.string(), status: v.string(),
  role: v.optional(v.string()),
});

export const getStyle = ownerQuery({
  args: { ownerUserId: v.string(), style: v.string(), world: v.optional(v.string()) },
  returns: v.object({
    id: v.id("worldStyles"), name: v.string(), slug: v.string(), line: v.optional(v.string()),
    family: v.string(), status: worldStyleStatusValidator,
    world: v.object({ id: v.id("folders"), key: v.string(), name: v.string(), short: v.string() }),
    universe: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }),
    shelf: v.union(v.null(), v.object({ id: v.id("folders"), name: v.string(), group: v.optional(v.string()), count: v.number() })),
    frameCount: v.number(),
    covers: v.array(frameValidator),
    coverAssetIds: v.array(v.id("assets")),
    recipes: v.array(v.object({
      name: v.optional(v.string()), label: v.string(),
      moodboards: v.array(boardRefValidator), profiles: v.array(profileRefValidator),
      unknownCodes: v.array(v.string()),
      parameters: v.optional(v.string()), template: v.optional(v.string()),
      frames: v.optional(v.number()), note: v.optional(v.string()),
    })),
    raises: v.array(v.string()), lowers: v.array(v.string()), notes: v.optional(v.string()),
    lock: v.union(v.null(), v.object({ id: v.id("stories"), title: v.string(), status: v.string(), revision: v.number() })),
    mergedInto: v.union(v.null(), v.object({ id: v.id("worldStyles"), name: v.string() })),
    mergedFrom: v.array(v.object({ id: v.id("worldStyles"), name: v.string() })),
    sortOrder: v.optional(v.number()), revision: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const style = await resolveStyle(ctx, owner, args.style, args.world);
    const root = await ctx.db.get(style.worldFolderId);
    if (!root?.worldKey) throw new ConvexError("This style's world no longer exists.");
    const { universe } = await universeOf(ctx, owner, root);
    const short = worldShortName(root.name, universe.name);
    const shelf = style.shelfFolderId ? await ctx.db.get(style.shelfFolderId) : null;
    const memo: WorldMemo = new Map();
    const recipes = [];
    for (const recipe of style.recipes) {
      const moodboards = [];
      for (const id of recipe.moodboardIds) {
        const board = await ctx.db.get(id);
        if (!owned(owner, board)) continue;
        const home = await worldRootOfFolder(ctx, board.folderId, memo);
        const previewIds = [
          ...(board.coverAssetId ? [board.coverAssetId] : []),
          ...(await ctx.db.query("moodboardItems").withIndex("by_moodboard_position", (q) => q.eq("moodboardId", board._id)).take(4)).map((item) => item.assetId),
        ];
        const previews: Frame[] = [];
        for (const assetId of [...new Set(previewIds)].slice(0, 3)) {
          const asset = await ctx.db.get(assetId);
          if (owned(owner, asset)) previews.push(await frameOf(ctx, asset));
        }
        moodboards.push({
          id: board._id, name: board.name, status: board.status, itemCount: board.itemCount, mjCode: board.mjCode,
          profileFlag: board.mjCode ? profileFlagForCode(board.mjCode) : board.mjMoodboardId ? profileFlagForMoodboardId(board.mjMoodboardId) : undefined,
          otherWorld: home && home._id !== root._id ? home.name : undefined,
          previews,
        });
      }
      const profiles = [];
      for (const id of recipe.profileIds) {
        const profile = await ctx.db.get(id);
        if (!owned(owner, profile)) continue;
        const use = profile.uses.find((entry) => entry.worldFolderId === root._id);
        profiles.push({ id: profile._id, name: profile.name, code: profile.code, flag: profileFlagForCode(profile.code), status: profile.status, role: use?.role });
      }
      recipes.push({
        name: recipe.name, label: recipeLabel(await recipeNames(ctx, recipe)),
        moodboards, profiles, unknownCodes: recipe.unknownCodes ?? [],
        parameters: recipe.parameters, template: recipe.template, frames: recipe.frames, note: recipe.note,
      });
    }
    const lock = style.lockStoryId ? await ctx.db.get(style.lockStoryId) : null;
    const into = style.mergedIntoStyleId ? await ctx.db.get(style.mergedIntoStyleId) : null;
    const mergedFrom = (await stylesOfWorld(ctx, owner, root._id))
      .filter((row) => row.mergedIntoStyleId === style._id).map((row) => ({ id: row._id, name: row.name }));
    return {
      id: style._id, name: style.name, slug: style.slug, line: style.line, family: style.family ?? short, status: style.status,
      world: { id: root._id, key: root.worldKey, name: root.name, short },
      universe: { id: universe._id, key: universe.worldKey!, name: universe.name },
      shelf: shelf && owned(owner, shelf) ? { id: shelf._id, name: shelf.name, group: shelf.group, count: shelf.memberCount ?? 0 } : null,
      frameCount: shelf ? shelf.memberCount ?? 0 : style.coverAssetIds.length,
      covers: await coversOf(ctx, owner, style, STYLE_LIMITS.covers),
      coverAssetIds: style.coverAssetIds,
      recipes, raises: style.raises, lowers: style.lowers, notes: style.notes,
      lock: lock && owned(owner, lock) ? { id: lock._id, title: lock.title, status: lock.status, revision: lock.revision } : null,
      mergedInto: into && owned(owner, into) ? { id: into._id, name: into.name } : null,
      mergedFrom, sortOrder: style.sortOrder, revision: style.revision, createdAt: style.createdAt, updatedAt: style.updatedAt,
    };
  },
});

// The frames of a style, newest filing first: its shelf's members, paged over
// the membership index. A style with no shelf shows its covers.
export const listStyleFramesPage = ownerQuery({
  args: { ownerUserId: v.string(), styleId: v.id("worldStyles"), paginationOpts: paginationOptsValidator, withPrompts: v.optional(v.boolean()) },
  returns: v.object({ page: v.array(frameValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const style = await ctx.db.get(args.styleId);
    if (!owned(owner, style)) throw new ConvexError("Style not found.");
    if (!style.shelfFolderId) {
      return { page: await coversOf(ctx, owner, style, STYLE_LIMITS.covers), isDone: true, continueCursor: "" };
    }
    const result = await ctx.db.query("assetFolders")
      .withIndex("by_folder_createdAt", (q) => q.eq("folderId", style.shelfFolderId!))
      .order("desc")
      .paginate({ numItems: Math.min(Math.max(1, args.paginationOpts.numItems), 100), cursor: args.paginationOpts.cursor });
    const page: Frame[] = [];
    for (const link of result.page) {
      const asset = await ctx.db.get(link.assetId);
      if (!owned(owner, asset)) continue;
      const frame = await frameOf(ctx, asset);
      if (args.withPrompts && asset.promptId) {
        const prompt = (await ctx.db.get(asset.promptId))?.text;
        if (prompt) frame.prompt = prompt.slice(0, 300);
      }
      page.push(frame);
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

// A style read as story: every storybook of the style's world that holds some
// of its frames, in the book's own order (first filed first, which is how
// books are built beat by beat), the first `perBook` frames each and how many
// it holds in all. Books with none of the style's frames are left out.
const STORY_LINKS_PER_BOOK = 400;
export const listStyleStories = ownerQuery({
  args: { ownerUserId: v.string(), styleId: v.id("worldStyles"), perBook: v.optional(v.number()) },
  returns: v.array(v.object({
    id: v.id("folders"), name: v.string(),
    count: v.number(), total: v.number(),
    frames: v.array(frameValidator),
  })),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const style = await ctx.db.get(args.styleId);
    if (!owned(owner, style)) throw new ConvexError("Style not found.");
    const shelfId = style.shelfFolderId;
    if (!shelfId) return [];
    const perBook = Math.min(Math.max(Math.floor(args.perBook ?? 12), 1), 40);
    const books = (await childrenOf(ctx, style.worldFolderId)).filter((child) => child.kind === "storybook" && owned(owner, child));
    const stories = [];
    for (const book of books) {
      const links = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", book._id))
        .order("asc").take(STORY_LINKS_PER_BOOK);
      const frames: Frame[] = [];
      let count = 0;
      for (const link of links) {
        const inStyle = await ctx.db.query("assetFolders")
          .withIndex("by_asset_folder", (q) => q.eq("assetId", link.assetId).eq("folderId", shelfId)).first();
        if (!inStyle) continue;
        count += 1;
        if (frames.length >= perBook) continue;
        const asset = await ctx.db.get(link.assetId);
        if (owned(owner, asset)) frames.push(await frameOf(ctx, asset));
      }
      if (count) stories.push({ id: book._id, name: book.name, count, total: book.memberCount ?? links.length, frames });
    }
    return stories.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },
});

/** The ids of every frame on a style's shelf, a page at a time (merges and agents). */
export const listStyleFrameIds = ownerQuery({
  args: { ownerUserId: v.string(), styleId: v.id("worldStyles"), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ assetIds: v.array(v.id("assets")), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const style = await ctx.db.get(args.styleId);
    if (!owned(args.ownerUserId, style)) throw new ConvexError("Style not found.");
    if (!style.shelfFolderId) return { assetIds: style.coverAssetIds, isDone: true, continueCursor: "" };
    const result = await ctx.db.query("assetFolders")
      .withIndex("by_folder_createdAt", (q) => q.eq("folderId", style.shelfFolderId!))
      .order("desc").paginate({ numItems: 500, cursor: args.cursor ?? null });
    return { assetIds: result.page.map((link) => link.assetId), isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** What the open view shows under a frame: its prompt and where it came from. */
export const getFrameDetail = ownerQuery({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.union(v.null(), v.object({
    assetId: v.id("assets"), prompt: v.optional(v.string()), agentDescription: v.optional(v.string()),
    modelName: v.optional(v.string()), sourceUrl: v.optional(v.string()), fileName: v.optional(v.string()), createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!owned(args.ownerUserId, asset)) return null;
    const prompt = asset.promptId ? await ctx.db.get(asset.promptId) : null;
    return {
      assetId: asset._id, prompt: prompt?.text, agentDescription: asset.agentDescription, modelName: asset.modelName,
      sourceUrl: asset.sourceUrl, fileName: asset.fileName, createdAt: asset.createdAt,
    };
  },
});

/* ── Snapshots for the journal ──────────────────────────────────────────── */

export type StyleSnapshot = Omit<Style, "_id" | "_creationTime"> & { styleId: Id<"worldStyles"> };

export const snapshotStyle = (style: Style): StyleSnapshot => {
  const { _id, _creationTime: _created, ...rest } = style;
  return { ...rest, styleId: _id };
};

const fieldsOf = (snapshot: StyleSnapshot) => {
  const { styleId: _id, ...fields } = snapshot;
  return fields;
};

/**
 * Put a style back to `before` if it still holds `after` (compared by content).
 * A null `before` removes a style the change created; a null `after` brings a
 * removed one back under its old content.
 */
export const restoreStyleSnapshot = async (
  ctx: MutationCtx, owner: string, styleId: Id<"worldStyles">, before: StyleSnapshot | null, after: StyleSnapshot | null,
): Promise<{ ok: true; restored: StyleSnapshot | null } | { ok: false; reason: string }> => {
  const current = await ctx.db.get(styleId);
  if (current && !owned(owner, current)) return { ok: false, reason: "the style belongs to someone else" };
  const now = current ? snapshotStyle(current) : null;
  if (!sameContent(now ? { ...now, updatedAt: 0 } : null, after ? { ...after, updatedAt: 0 } : null)) {
    return { ok: false, reason: `the style "${current?.name ?? after?.name ?? styleId}" changed since; undo the later change first` };
  }
  if (!before) {
    if (current) await ctx.db.delete(current._id);
    return { ok: true, restored: null };
  }
  if (current) {
    const revision = current.revision + 1;
    await ctx.db.replace(current._id, { ...fieldsOf(before), revision, updatedAt: Date.now() });
    return { ok: true, restored: snapshotStyle((await ctx.db.get(current._id))!) };
  }
  const id = await ctx.db.insert("worldStyles", { ...fieldsOf(before), updatedAt: Date.now() });
  return { ok: true, restored: snapshotStyle((await ctx.db.get(id))!) };
};

/* ── Writes ──────────────────────────────────────────────────────────────── */

const recipeInput = v.object({
  name: v.optional(v.string()),
  moodboardIds: v.optional(v.array(v.string())),
  profileIds: v.optional(v.array(v.string())),
  unknownCodes: v.optional(v.array(v.string())),
  parameters: v.optional(v.string()),
  template: v.optional(v.string()),
  frames: v.optional(v.number()),
  note: v.optional(v.string()),
});

const resolveRecipes = async (ctx: MutationCtx, owner: string, input: Infer<typeof recipeInput>[]): Promise<Recipe[]> => {
  if (input.length > STYLE_LIMITS.recipes) throw new ConvexError(`A style holds at most ${STYLE_LIMITS.recipes} recipes.`);
  const out: Recipe[] = [];
  for (const [index, recipe] of input.entries()) {
    const label = `Recipe ${index + 1}`;
    const moodboardIds: Id<"moodboards">[] = [];
    for (const ref of recipe.moodboardIds ?? []) {
      const id = ctx.db.normalizeId("moodboards", ref.trim().replace(/^moodboard:/, ""));
      const board = id ? await ctx.db.get(id) : null;
      if (!owned(owner, board)) throw new ConvexError(`${label}: moodboard ${ref} not found. list_moodboards gives the ids.`);
      moodboardIds.push(board._id);
    }
    const profileIds: Id<"mjProfiles">[] = [];
    for (const ref of recipe.profileIds ?? []) {
      const value = ref.trim().replace(/^profile:/, "");
      const id = ctx.db.normalizeId("mjProfiles", value);
      let profile = id ? await ctx.db.get(id) : null;
      if (!profile) {
        for (const candidate of resolveUserIdCandidates(owner)) {
          profile ??= await ctx.db.query("mjProfiles").withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", value)).first();
          profile ??= await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("normalizedName", value.toLowerCase())).first();
        }
      }
      if (!owned(owner, profile)) throw new ConvexError(`${label}: profile ${ref} not found. mj_profiles {op: "list"} gives the ids.`);
      profileIds.push(profile._id);
    }
    const unknownCodes = (recipe.unknownCodes ?? []).map((code) => code.trim()).filter(Boolean);
    if (moodboardIds.length + profileIds.length + unknownCodes.length > STYLE_LIMITS.codes) throw new ConvexError(`${label}: at most ${STYLE_LIMITS.codes} codes.`);
    if (recipe.frames !== undefined && (!Number.isInteger(recipe.frames) || recipe.frames < 0)) throw new ConvexError(`${label}: frames is a whole number.`);
    out.push({
      name: clip(recipe.name, STYLE_LIMITS.name, `${label} name`), moodboardIds, profileIds,
      ...(unknownCodes.length ? { unknownCodes } : {}),
      parameters: clip(recipe.parameters, STYLE_LIMITS.parameters, `${label} parameters`),
      template: clip(recipe.template, STYLE_LIMITS.recipeText, `${label} template`),
      frames: recipe.frames, note: clip(recipe.note, STYLE_LIMITS.recipeText, `${label} note`),
    });
  }
  return out;
};

const resolveCovers = async (ctx: MutationCtx, owner: string, worldId: Id<"folders">, refs: string[]) => {
  const ids: Id<"assets">[] = [];
  for (const ref of refs) {
    const id = ctx.db.normalizeId("assets", ref.trim().replace(/^asset:/, ""));
    const asset = id ? await ctx.db.get(id) : null;
    if (!owned(owner, asset)) throw new ConvexError(`Cover ${ref} not found.`);
    if (!ids.includes(asset._id)) ids.push(asset._id);
  }
  if (ids.length > STYLE_LIMITS.covers) throw new ConvexError(`A style has at most ${STYLE_LIMITS.covers} covers.`);
  await assertAssetsFitWorld(ctx, worldId, ids, "A style's covers");
  return ids;
};

const styleOnShelf = async (ctx: Ctx, owner: string, shelfId: Id<"folders">) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const hit = await ctx.db.query("worldStyles").withIndex("by_owner_shelf", (q) => q.eq("ownerUserId", candidate).eq("shelfFolderId", shelfId)).first();
    if (hit) return hit;
  }
  return null;
};

const resolveShelfRef = (root: Folder, children: Folder[], ref: string) => {
  const value = ref.trim().replace(/^(folder|collection|shelf):/, "");
  const lower = value.toLowerCase();
  const hit = children.find((child) => child._id === value) ?? children.find((child) => child.name.toLowerCase() === lower);
  if (!hit) throw new ConvexError(`"${ref}" is not a shelf of ${root.name}.`);
  if (hit.kind === "storybook") throw new ConvexError(`"${hit.name}" is a storybook; a style's frames live on a plain shelf.`);
  return hit;
};

export const saveStyle = ownerMutation({
  args: {
    ownerUserId: v.string(), world: v.string(),
    // Omit to create; give style:<id> or its name to change it.
    style: v.optional(v.string()),
    name: v.optional(v.string()),
    line: v.optional(v.union(v.string(), v.null())),
    family: v.optional(v.union(v.string(), v.null())),
    status: v.optional(worldStyleStatusValidator),
    // Its shelf: a shelf of the world (name or id). On create, omitted = the
    // shelf with the style's name, made in the group Styles when missing.
    // null on a patch unlinks it (the shelf and its frames stay).
    shelf: v.optional(v.union(v.string(), v.null())),
    coverAssetIds: v.optional(v.array(v.string())),
    addCoverAssetIds: v.optional(v.array(v.string())),
    recipes: v.optional(v.array(recipeInput)),
    raises: v.optional(v.array(v.string())),
    lowers: v.optional(v.array(v.string())),
    lockStoryId: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    sortOrder: v.optional(v.union(v.number(), v.null())),
    expectedRevision: v.optional(v.number()),
    ...journalArgs,
  },
  returns: v.object({
    styleId: v.id("worldStyles"), created: v.boolean(), changed: v.boolean(), revision: v.number(),
    shelfId: v.optional(v.id("folders")), shelfCreated: v.boolean(), changeId: v.union(v.null(), v.id("worldChanges")),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const children = (await childrenOf(ctx, root._id)).filter((child) => owned(owner, child));
    const existing = args.style ? await resolveStyle(ctx, owner, args.style, root._id) : null;
    if (existing && existing.worldFolderId !== root._id) {
      throw new ConvexError(`"${existing.name}" is a style of another world; save it with that world.`);
    }
    if (existing && args.expectedRevision !== undefined && args.expectedRevision !== existing.revision) {
      throw new ConvexError(`"${existing.name}" changed since you read it: now revision ${existing.revision}. Read it again with get_style.`);
    }
    const now = Date.now();
    const name = args.name === undefined ? existing?.name : clip(args.name, STYLE_LIMITS.name, "A style name");
    if (!name) throw new ConvexError("A style needs a name.");
    const slug = styleSlug(name);
    if (!slug) throw new ConvexError("A style name needs letters or digits.");
    if (!existing || slug !== existing.slug) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        const clash = await ctx.db.query("worldStyles").withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", root._id).eq("slug", slug)).first();
        if (clash && clash._id !== existing?._id) {
          if (!existing) {
            throw new ConvexError(`${root.name} already has the style "${clash.name}" (style:${clash._id}). Change it by passing style; merge two with merge_styles.`);
          }
          throw new ConvexError(`${root.name} already has a style named "${clash.name}".`);
        }
      }
    }

    // The shelf: given, the same-named shelf, or a new one in Styles.
    let shelfId = existing?.shelfFolderId;
    let shelfCreated = false;
    if (args.shelf === null) shelfId = undefined;
    else if (args.shelf !== undefined) shelfId = resolveShelfRef(root, children, args.shelf)._id;
    else if (!existing) {
      const same = children.find((child) => !child.kind && child.name.toLowerCase() === name.toLowerCase());
      if (same) shelfId = same._id;
      else {
        const shelfName = normalizeFolderName(name);
        const normalizedName = scopedName(shelfName, root._id);
        await assertNameFree(ctx, owner, normalizedName);
        shelfId = await ctx.db.insert("folders", {
          ownerUserId: owner, name: shelfName, normalizedName, parentFolderId: root._id, group: STYLE_SHELF_GROUP,
          memberCount: 0, createdAt: now, updatedAt: now,
        });
        shelfCreated = true;
        await recordWorldChange(ctx, {
          ownerUserId: owner, worldFolderId: root._id, op: "shelf.create", targetType: "shelf", targetId: shelfId,
          summary: `Created shelf "${shelfName}" in ${STYLE_SHELF_GROUP} for the style`, after: { folderId: shelfId }, ...meta(args),
        });
      }
    }
    if (shelfId && shelfId !== existing?.shelfFolderId) {
      const taken = await styleOnShelf(ctx, owner, shelfId);
      if (taken && taken._id !== existing?._id) throw new ConvexError(`That shelf already holds the style "${taken.name}" (style:${taken._id}).`);
    }

    // A rename follows onto the shelf when the shelf carried the old name.
    if (existing && shelfId && name !== existing.name && args.shelf === undefined) {
      const shelf = children.find((child) => child._id === shelfId);
      if (shelf && shelf.name.toLowerCase() === existing.name.toLowerCase()) {
        const shelfName = normalizeFolderName(name);
        const normalizedName = scopedName(shelfName, root._id);
        if (normalizedName !== shelf.normalizedName) await assertNameFree(ctx, owner, normalizedName, shelf._id);
        const before = shelfState(shelf);
        await ctx.db.patch(shelf._id, { name: shelfName, normalizedName, updatedAt: now });
        await recordWorldChange(ctx, {
          ownerUserId: owner, worldFolderId: root._id, op: "shelf.update", targetType: "shelf", targetId: shelf._id,
          summary: `Renamed shelf "${shelf.name}" to "${shelfName}" with its style`,
          before: { ...before, showcased: shelf.showcased, showcaseFeatured: shelf.showcaseFeatured },
          after: { ...before, name: shelfName, normalizedName }, ...meta(args),
        });
      }
    }

    let coverAssetIds = existing?.coverAssetIds ?? [];
    if (args.coverAssetIds !== undefined) coverAssetIds = await resolveCovers(ctx, owner, root._id, args.coverAssetIds);
    if (args.addCoverAssetIds?.length) {
      const added = await resolveCovers(ctx, owner, root._id, args.addCoverAssetIds);
      coverAssetIds = [...added, ...coverAssetIds.filter((id) => !added.includes(id))];
      if (coverAssetIds.length > STYLE_LIMITS.covers) coverAssetIds = coverAssetIds.slice(0, STYLE_LIMITS.covers);
    }

    let lockStoryId = existing?.lockStoryId;
    if (args.lockStoryId === null) lockStoryId = undefined;
    else if (args.lockStoryId !== undefined) {
      const id = ctx.db.normalizeId("stories", args.lockStoryId.trim().replace(/^story:/, ""));
      const story = id ? await ctx.db.get(id) : null;
      if (!owned(owner, story)) throw new ConvexError(`Story ${args.lockStoryId} not found.`);
      lockStoryId = story._id;
    }

    const fields = {
      ownerUserId: existing?.ownerUserId ?? owner, worldFolderId: root._id, name, slug,
      line: args.line === undefined ? existing?.line : clip(args.line, STYLE_LIMITS.line, "A style line"),
      family: args.family === undefined ? existing?.family : clip(args.family, STYLE_LIMITS.family, "A style family"),
      status: args.status ?? existing?.status ?? "draft" as const,
      shelfFolderId: shelfId,
      coverAssetIds,
      recipes: args.recipes === undefined ? existing?.recipes ?? [] : await resolveRecipes(ctx, owner, args.recipes),
      raises: args.raises === undefined ? existing?.raises ?? [] : clipList(args.raises, "raises"),
      lowers: args.lowers === undefined ? existing?.lowers ?? [] : clipList(args.lowers, "lowers"),
      lockStoryId,
      notes: args.notes === undefined ? existing?.notes : clip(args.notes, STYLE_LIMITS.notes, "Style notes"),
      mergedIntoStyleId: args.status && args.status !== "merged" ? undefined : existing?.mergedIntoStyleId,
      sortOrder: args.sortOrder === undefined ? existing?.sortOrder : args.sortOrder ?? undefined,
    };

    if (existing) {
      const before = snapshotStyle(existing);
      const next = { ...before, ...fields, revision: existing.revision, updatedAt: existing.updatedAt };
      if (sameContent(before, next)) {
        return { styleId: existing._id, created: false, changed: false, revision: existing.revision, shelfId, shelfCreated, changeId: null };
      }
      const revision = existing.revision + 1;
      await ctx.db.patch(existing._id, { ...fields, revision, updatedAt: now });
      const after = snapshotStyle((await ctx.db.get(existing._id))!);
      const changeId = await recordWorldChange(ctx, {
        ownerUserId: owner, worldFolderId: root._id, op: "style.save", targetType: "style", targetId: existing._id,
        summary: `Updated style "${name}"${name !== existing.name ? ` (was "${existing.name}")` : ""}`, before, after, ...meta(args),
      });
      return { styleId: existing._id, created: false, changed: true, revision, shelfId, shelfCreated, changeId };
    }

    const styleId = await ctx.db.insert("worldStyles", { ...fields, revision: 1, createdAt: now, updatedAt: now });
    const after = snapshotStyle((await ctx.db.get(styleId))!);
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op: "style.save", targetType: "style", targetId: styleId,
      summary: `Created style "${name}"`, before: null, after, ...meta(args),
    });
    return { styleId, created: true, changed: true, revision: 1, shelfId, shelfCreated, changeId };
  },
});

/**
 * Fold one style's record into another: recipes, covers, raises and lowers
 * join `into`, `from` becomes merged (kept, pointing at `into`) and its shelf
 * moves to the group Merged. Frames move first, through world_file (the
 * agent route does that), so this never touches membership.
 */
export const mergeStyleRecords = ownerMutation({
  args: { ownerUserId: v.string(), from: v.id("worldStyles"), into: v.id("worldStyles"), dryRun: v.optional(v.boolean()), ...journalArgs },
  returns: v.object({
    dryRun: v.boolean(), from: v.string(), into: v.string(),
    recipesAdded: v.number(), coversAdded: v.number(), changeId: v.union(v.null(), v.id("worldChanges")),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const from = await ctx.db.get(args.from);
    const into = await ctx.db.get(args.into);
    if (!owned(owner, from) || !owned(owner, into)) throw new ConvexError("Style not found.");
    if (from._id === into._id) throw new ConvexError("A style cannot merge into itself.");
    if (into.status === "merged") throw new ConvexError(`"${into.name}" is itself merged; merge into the style it points at.`);
    const root = await ctx.db.get(into.worldFolderId);
    if (!root) throw new ConvexError("The target style's world is gone.");
    const key = (recipe: Recipe) => JSON.stringify([recipe.moodboardIds, recipe.profileIds, recipe.unknownCodes ?? [], recipe.parameters ?? ""]);
    const have = new Set(into.recipes.map(key));
    const newRecipes = from.recipes.filter((recipe) => !have.has(key(recipe)));
    const recipes = [...into.recipes, ...newRecipes].slice(0, STYLE_LIMITS.recipes);
    const covers = [...into.coverAssetIds, ...from.coverAssetIds.filter((id) => !into.coverAssetIds.includes(id))];
    const fitting: Id<"assets">[] = [];
    for (const id of covers) {
      if (fitting.length >= STYLE_LIMITS.covers) break;
      const asset = await ctx.db.get(id);
      if (!asset) continue;
      const worlds = new Set<Id<"folders">>();
      for (const folderId of await assetFolderIds(ctx, asset)) {
        const world = await worldRootOfFolder(ctx, folderId);
        if (world) worlds.add(world._id);
      }
      if (worlds.size === 0 || worlds.has(root._id)) fitting.push(id);
    }
    const report = {
      dryRun: Boolean(args.dryRun), from: from.name, into: into.name,
      recipesAdded: recipes.length - into.recipes.length, coversAdded: fitting.filter((id) => !into.coverAssetIds.includes(id)).length,
    };
    if (args.dryRun) return { ...report, changeId: null };

    const now = Date.now();
    const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(0, STYLE_LIMITS.listItems);
    const beforeInto = snapshotStyle(into);
    const beforeFrom = snapshotStyle(from);
    await ctx.db.patch(into._id, {
      recipes, coverAssetIds: fitting, raises: union(into.raises, from.raises), lowers: union(into.lowers, from.lowers),
      notes: [into.notes, `Merged from "${from.name}" ${new Date(now).toISOString().slice(0, 10)}.`].filter(Boolean).join("\n").slice(-STYLE_LIMITS.notes),
      revision: into.revision + 1, updatedAt: now,
    });
    await ctx.db.patch(from._id, { status: "merged", mergedIntoStyleId: into._id, revision: from.revision + 1, updatedAt: now });
    let shelf: { folderId: Id<"folders">; before?: string; after: string } | null = null;
    const fromShelf = from.shelfFolderId ? await ctx.db.get(from.shelfFolderId) : null;
    if (fromShelf && owned(owner, fromShelf) && fromShelf._id !== into.shelfFolderId) {
      shelf = { folderId: fromShelf._id, before: fromShelf.group, after: MERGED_SHELF_GROUP };
      await ctx.db.patch(fromShelf._id, { group: MERGED_SHELF_GROUP, updatedAt: now });
    }
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op: "style.merge", targetType: "style", targetId: into._id,
      summary: `Merged style "${from.name}" into "${into.name}"`,
      before: { into: beforeInto, from: beforeFrom, shelf: shelf ? { folderId: shelf.folderId, group: shelf.before ?? null } : null },
      after: {
        into: snapshotStyle((await ctx.db.get(into._id))!), from: snapshotStyle((await ctx.db.get(from._id))!),
        shelf: shelf ? { folderId: shelf.folderId, group: shelf.after } : null,
      },
      ...meta(args),
    });
    return { ...report, changeId };
  },
});

export type MergeState = {
  into: StyleSnapshot; from: StyleSnapshot;
  shelf: { folderId: Id<"folders">; group: string | null } | null;
};

/** Undo of style.merge: both records and the shelf group go back together. */
export const revertStyleMerge = async (ctx: MutationCtx, owner: string, before: MergeState, after: MergeState) => {
  if (after.shelf) {
    const folder = await ctx.db.get(after.shelf.folderId);
    if (folder && (folder.group ?? null) !== after.shelf.group) return { ok: false as const, reason: `the shelf "${folder.name}" was regrouped since` };
  }
  const into = await restoreStyleSnapshot(ctx, owner, after.into.styleId, before.into, after.into);
  if (!into.ok) return into;
  const from = await restoreStyleSnapshot(ctx, owner, after.from.styleId, before.from, after.from);
  if (!from.ok) return from;
  if (before.shelf) {
    const folder = await ctx.db.get(before.shelf.folderId);
    if (folder) await ctx.db.patch(folder._id, { group: before.shelf.group ?? undefined, updatedAt: Date.now() });
  }
  return { ok: true as const, restored: { into: into.restored, from: from.restored, shelf: before.shelf } };
};

/** Put a world into another world's universe (or take it out with null). */
export const setWorldUniverse = ownerMutation({
  args: { ownerUserId: v.string(), world: v.string(), universe: v.union(v.string(), v.null()), ...journalArgs },
  returns: v.object({ world: v.string(), universe: v.union(v.null(), v.string()), changed: v.boolean(), changeId: v.union(v.null(), v.id("worldChanges")) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    let head: Folder | null = null;
    if (args.universe !== null) {
      head = await resolveWorld(ctx, owner, args.universe);
      if (head._id === root._id) head = null;
      else if (head.universeRootId) {
        throw new ConvexError(`${head.name} is itself part of another universe; join that universe's own world instead.`);
      }
    }
    if (!head && args.universe !== null) throw new ConvexError("A world is its own universe already; pass null to leave one.");
    if (head) {
      const members = (await listWorldRoots(ctx, owner)).filter((row) => row.universeRootId === root._id);
      if (members.length) throw new ConvexError(`${root.name} is the universe of ${members.map((row) => row.name).join(", ")}; it cannot join another.`);
    }
    const next = head?._id;
    if ((root.universeRootId ?? undefined) === next) {
      return { world: root.worldKey!, universe: head?.worldKey ?? null, changed: false, changeId: null };
    }
    const before = { universeRootId: root.universeRootId ?? null };
    await ctx.db.patch(root._id, { universeRootId: next, updatedAt: Date.now() });
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op: "world.universe", targetType: "world", targetId: root._id,
      summary: head ? `${root.name} joined the universe of ${head.name}` : `${root.name} left its universe`,
      before, after: { universeRootId: next ?? null }, ...meta(args),
    });
    return { world: root.worldKey!, universe: head?.worldKey ?? null, changed: true, changeId };
  },
});

/* ── "Is this in the gallery?" ───────────────────────────────────────────── */

const lookupMatchValidator = v.object({
  assetId: v.id("assets"), job: v.optional(v.string()), index: v.optional(v.number()),
  fileName: v.optional(v.string()), sourceUrl: v.optional(v.string()), thumbUrl: v.optional(v.string()),
  worlds: v.array(v.string()),
  styles: v.array(v.object({ id: v.id("worldStyles"), name: v.string() })),
});

const PREFIX_TAKE = 24;

export const findAssets = ownerQuery({
  args: { ownerUserId: v.string(), items: v.array(v.string()) },
  returns: v.array(v.object({
    query: v.string(), kind: v.string(), found: v.boolean(), matches: v.array(lookupMatchValidator),
  })),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const owners = resolveUserIdCandidates(owner);
    if (args.items.length > STYLE_LIMITS.lookupChunk) throw new ConvexError(`Look up at most ${STYLE_LIMITS.lookupChunk} items per call.`);
    const memo: WorldMemo = new Map();
    const styleMemo = new Map<Id<"folders">, Style | null>();
    const describe = async (asset: Doc<"assets">) => {
      const worlds = new Set<string>();
      const styles: { id: Id<"worldStyles">; name: string }[] = [];
      for (const folderId of await assetFolderIds(ctx, asset)) {
        const world = await worldRootOfFolder(ctx, folderId, memo);
        if (world?.worldKey) worlds.add(world.worldKey);
        if (!styleMemo.has(folderId)) styleMemo.set(folderId, await styleOnShelf(ctx, owner, folderId));
        const style = styleMemo.get(folderId);
        if (style && style.status !== "merged") styles.push({ id: style._id, name: style.name });
      }
      const identity = mjIdentityOf(asset);
      return {
        assetId: asset._id, job: identity?.job, index: identity?.index,
        fileName: asset.fileName, sourceUrl: asset.sourceUrl,
        thumbUrl: asset.thumbR2Key ? buildR2PublicUrl(asset.thumbR2Key) : undefined,
        worlds: [...worlds], styles,
      };
    };
    const prefixRows = async (index: "by_owner_sourceUrl" | "by_owner_fileName", prefix: string) => {
      const rows: Doc<"assets">[] = [];
      for (const candidate of owners) {
        rows.push(...await (index === "by_owner_sourceUrl"
          ? ctx.db.query("assets").withIndex("by_owner_sourceUrl", (q) => q.eq("ownerUserId", candidate).gte("sourceUrl", prefix).lt("sourceUrl", `${prefix}￿`))
          : ctx.db.query("assets").withIndex("by_owner_fileName", (q) => q.eq("ownerUserId", candidate).gte("fileName", prefix).lt("fileName", `${prefix}￿`))
        ).take(PREFIX_TAKE));
      }
      return rows;
    };

    const out = [];
    for (const item of args.items) {
      const query = parseLookupQuery(item);
      if (!query) continue;
      const found = new Map<Id<"assets">, Doc<"assets">>();
      if (query.kind === "asset") {
        const id = ctx.db.normalizeId("assets", query.assetId);
        const asset = id ? await ctx.db.get(id) : null;
        if (owned(owner, asset)) found.set(asset._id, asset);
      } else if (query.kind === "mj") {
        const rows = [
          ...(await Promise.all(mjSourcePrefixes(query.job).map((prefix) => prefixRows("by_owner_sourceUrl", prefix)))).flat(),
          ...await prefixRows("by_owner_fileName", mjFilePrefix(query.job)),
        ];
        for (const asset of rows) if (mjMatches(query, mjIdentityOf(asset))) found.set(asset._id, asset);
      } else {
        const value = query.kind === "url" ? query.url : query.value;
        for (const candidate of owners) {
          for (const asset of await ctx.db.query("assets").withIndex("by_owner_sourceUrl", (q) => q.eq("ownerUserId", candidate).eq("sourceUrl", value)).take(10)) found.set(asset._id, asset);
          if (query.kind === "name") {
            for (const asset of await ctx.db.query("assets").withIndex("by_owner_fileName", (q) => q.eq("ownerUserId", candidate).eq("fileName", value)).take(10)) found.set(asset._id, asset);
            for (const asset of await ctx.db.query("assets").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", value)).take(10)) found.set(asset._id, asset);
          }
        }
      }
      const matches = [];
      for (const asset of found.values()) matches.push(await describe(asset));
      out.push({ query: item, kind: query.kind, found: matches.length > 0, matches });
    }
    return out;
  },
});
