import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { assetFolderIds, childrenOf, resolveWorld, worldRootOfFolder, type WorldMemo } from "./worldCore";
import { recipeViewsOf } from "./styleRecipes";
import { WORLD_DOC_LEARNINGS, WORLD_DOC_MAIN } from "../lib/world-docs";
import { mjFilePrefix, mjIdentityOf, mjMatches, mjSourcePrefixes, parseLookupQuery } from "../lib/world-styles";
import {
  VOTE, WRITER_BRIEF_LIMITS, castLines, commandCodes, composeBrief, isBibleTitle, isCastTitle, isWorldKnowledgeDoc, pickWorld, recipeCodes,
  type BriefPart, type BriefTier, type WorldVote,
} from "../lib/writer-brief";

// The world brief of the extension's writer (lib/writer-brief.ts): which world
// a Midjourney command belongs to, read from its codes, and that world's own
// files laid out as one text. The writer runs with no tools, on the Mac or at
// a provider; the gallery reads the bible for it here, from the same rows
// open_world hands an agent.

type Folder = Doc<"folders">;
type Ctx = QueryCtx;

const owned = <T extends { ownerUserId?: string }>(owner: string, row: T | null): row is T =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId ?? ""));

const universeKeyOf = async (ctx: Ctx, owner: string, root: Folder) => {
  const head = root.universeRootId ? await ctx.db.get(root.universeRootId) : null;
  return head?.worldKey && owned(owner, head) ? head : root;
};

const stylesOfOwner = async (ctx: Ctx, owner: string, worldId?: Id<"folders">) => {
  const rows: Doc<"worldStyles">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await (worldId
      ? ctx.db.query("worldStyles").withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId))
      : ctx.db.query("worldStyles").withIndex("by_owner_world_slug", (q) => q.eq("ownerUserId", candidate))
    ).collect());
  }
  return rows.filter((style) => style.status !== "merged" && style.status !== "archived");
};

/**
 * The world a Midjourney frame is already saved in, and the named style of its
 * shelf. This outranks the codes: two worlds can share every code (a style
 * code used across worlds), and only the saved frame says which one it is.
 */
async function worldOfFrame(ctx: Ctx, owner: string, frame: string | undefined) {
  const none = { world: null as Folder | null, style: null as Doc<"worldStyles"> | null };
  const query = frame?.trim() ? parseLookupQuery(frame.trim().slice(0, 600)) : null;
  if (!query || query.kind !== "mj" || query.index === undefined) return none;
  const found = new Map<Id<"assets">, Doc<"assets">>();
  for (const candidate of resolveUserIdCandidates(owner)) {
    for (const prefix of mjSourcePrefixes(query.job)) {
      const rows = await ctx.db.query("assets")
        .withIndex("by_owner_sourceUrl", (q) => q.eq("ownerUserId", candidate).gte("sourceUrl", prefix).lt("sourceUrl", `${prefix}\uffff`)).take(24);
      for (const asset of rows) if (mjMatches(query, mjIdentityOf(asset))) found.set(asset._id, asset);
    }
    const prefix = mjFilePrefix(query.job);
    const rows = await ctx.db.query("assets")
      .withIndex("by_owner_fileName", (q) => q.eq("ownerUserId", candidate).gte("fileName", prefix).lt("fileName", `${prefix}\uffff`)).take(24);
    for (const asset of rows) if (mjMatches(query, mjIdentityOf(asset))) found.set(asset._id, asset);
  }
  const memo: WorldMemo = new Map();
  const worlds = new Map<Id<"folders">, Folder>();
  const styles = new Map<Id<"worldStyles">, Doc<"worldStyles">>();
  for (const asset of found.values()) {
    for (const folderId of await assetFolderIds(ctx, asset)) {
      const world = await worldRootOfFolder(ctx, folderId, memo);
      if (!world?.worldKey || !owned(owner, world)) continue;
      worlds.set(world._id, world);
      for (const candidate of resolveUserIdCandidates(owner)) {
        const style = await ctx.db.query("worldStyles")
          .withIndex("by_owner_shelf", (q) => q.eq("ownerUserId", candidate).eq("shelfFolderId", folderId)).first();
        if (style && style.status !== "merged" && style.status !== "archived") styles.set(style._id, style);
      }
    }
  }
  if (worlds.size !== 1) return none;
  return { world: [...worlds.values()][0]!, style: styles.size === 1 ? [...styles.values()][0]! : null };
}

/** The world a command's codes point at: moodboards, profiles and style recipes vote. */
async function worldOfCommand(ctx: Ctx, owner: string, command: string | undefined) {
  const codes = commandCodes(command);
  const all = [...codes.profiles, ...codes.srefs];
  if (all.length === 0) return { world: null as Folder | null, tie: [] as string[] };
  const memo: WorldMemo = new Map();
  const roots = new Map<string, Folder>();
  const votes: WorldVote[] = [];
  const vote = async (root: Folder | null, weight: number) => {
    if (!root?.worldKey || !owned(owner, root)) return;
    roots.set(root.worldKey, root);
    const universe = await universeKeyOf(ctx, owner, root);
    if (universe.worldKey) roots.set(universe.worldKey, universe);
    votes.push({ world: root.worldKey, universe: universe.worldKey ?? root.worldKey, weight });
  };

  for (const code of codes.profiles) {
    for (const candidate of resolveUserIdCandidates(owner)) {
      const boards = await ctx.db.query("moodboards")
        .withIndex("by_owner_mjCode", (q) => q.eq("ownerUserId", candidate).eq("mjCode", code)).take(8);
      for (const board of boards) await vote(await worldRootOfFolder(ctx, board.folderId, memo), VOTE.moodboard);
      const profiles = await ctx.db.query("mjProfiles")
        .withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", code)).take(8);
      for (const profile of profiles.filter((row) => row.status === "active")) {
        const worlds = [...new Set(profile.uses.map((use) => use.worldFolderId))];
        for (const worldId of worlds) {
          await vote(await ctx.db.get(worldId), worlds.length === 1 ? VOTE.ownProfile : VOTE.sharedProfile);
        }
      }
    }
  }
  // A style recipe that carries one of the command's codes in its own text
  // (a --sref number, a code the gallery has no record for).
  // One vote per world, however many of its styles carry the code.
  const wanted = new Set(all);
  const styleWorlds = new Set<Id<"folders">>();
  for (const style of await stylesOfOwner(ctx, owner)) {
    if (styleWorlds.has(style.worldFolderId)) continue;
    if (style.recipes.some((recipe) => [...recipeCodes(recipe)].some((code) => wanted.has(code)))) {
      styleWorlds.add(style.worldFolderId);
      await vote(await ctx.db.get(style.worldFolderId), VOTE.style);
    }
  }

  const pick = pickWorld(votes);
  return {
    world: pick.world ? roots.get(pick.world) ?? null : null,
    tie: pick.tie.map((key) => roots.get(key)?.name ?? key),
  };
}

/** The named style of the world whose recipe is made of exactly the command's codes. */
async function styleOfCommand(ctx: Ctx, owner: string, worldId: Id<"folders">, command: string | undefined) {
  const codes = commandCodes(command);
  const wanted = new Set([...codes.profiles, ...codes.srefs]);
  if (wanted.size === 0) return null;
  let best: { style: Doc<"worldStyles">; share: number } | null = null;
  for (const style of await stylesOfOwner(ctx, owner, worldId)) {
    for (const view of await recipeViewsOf(ctx, owner, style)) {
      const found = commandCodes(view.params);
      const own = new Set([...found.profiles, ...found.srefs]);
      if (own.size === 0) continue;
      // Only a recipe with exactly the command's codes: a style is named for
      // the writer as fact, so a near match is not good enough.
      const shared = [...own].filter((code) => wanted.has(code)).length;
      const share = shared === own.size && shared === wanted.size ? 1 : 0;
      if (share === 1 && !best) best = { style, share };
    }
  }
  return best?.style ?? null;
}

const stylePart = async (ctx: Ctx, owner: string, style: Doc<"worldStyles">): Promise<BriefPart> => {
  const lockStory = style.lockStoryId ? await ctx.db.get(style.lockStoryId) : null;
  const lock = owned(owner, lockStory) ? lockStory.body : "";
  return {
    key: "style", label: "style", title: `THE NAMED STYLE OF THIS FRAME: ${style.name}`,
    text: [
      style.line?.trim() ?? "",
      style.raises.length ? `Raises the look: ${style.raises.join("; ")}` : "",
      style.lowers.length ? `Lowers the look: ${style.lowers.join("; ")}` : "",
      lock.trim() ? `Style lock:\n${lock.trim()}` : "",
    ].filter(Boolean).join("\n"),
  };
};

const storiesOf = async (ctx: Ctx, owner: string, folders: Folder[]) => {
  const rows: Doc<"stories">[] = [];
  for (const folder of folders) {
    for (const candidate of resolveUserIdCandidates(owner)) {
      rows.push(...await ctx.db.query("stories")
        .withIndex("by_owner_folder_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("folderId", folder._id))
        .order("desc").take(200));
    }
  }
  return rows.filter((story) => story.status !== "archived");
};

const docsOf = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const rows: Doc<"worldDocs">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("worldDocs")
      .withIndex("by_owner_world_path", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId)).collect());
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
};

const castOf = async (ctx: Ctx, owner: string, worldId: Id<"folders">) => {
  const rows: Doc<"characters">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("characters")
      .withIndex("by_owner_world_number", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId)).collect());
  }
  return rows;
};

/** Every part of a world's brief, in no particular order (composeBrief orders and cuts). */
async function partsOf(ctx: Ctx, owner: string, root: Folder, style: Doc<"worldStyles"> | null) {
  const parts: BriefPart[] = [];
  const universe = await universeKeyOf(ctx, owner, root);
  const shared = universe._id !== root._id;

  const docs = await docsOf(ctx, owner, root._id);
  const main = docs.find((doc) => doc.path === WORLD_DOC_MAIN);
  const learned = docs.find((doc) => doc.path === WORLD_DOC_LEARNINGS);
  if (main?.body.trim()) parts.push({ key: "rules", label: "rules", title: `${WORLD_DOC_MAIN} (the rule file of ${root.name})`, text: main.body });
  if (learned?.body.trim()) parts.push({ key: "learnings", label: "learnings", title: `${WORLD_DOC_LEARNINGS} (what the art director picked and rejected)`, text: learned.body });
  if (style) parts.push(await stylePart(ctx, owner, style));

  // Cast, bible and reference docs: the world's own, then its universe's when
  // the world reads in a bigger story (DEAR ANNETE — ART DECO in DEAR ANNETE).
  const ownChildren = (await childrenOf(ctx, root._id)).filter((child) => owned(owner, child));
  const ownStories = await storiesOf(ctx, owner, [root, ...ownChildren]);
  const universeChildren = shared ? (await childrenOf(ctx, universe._id)).filter((child) => owned(owner, child)) : [];
  const universeStories = shared ? await storiesOf(ctx, owner, [universe, ...universeChildren]) : [];
  const knowledge = (stories: Doc<"stories">[]) => stories.filter((story) => story.kind !== "style-lock");

  const cast = await castOf(ctx, owner, root._id);
  const castRows = cast.length > 0 || !shared ? cast : await castOf(ctx, owner, universe._id);
  const castText = castLines(castRows.map((row) => ({
    code: row.code, name: row.name, alias: row.alias, otherNames: row.otherNames, role: row.role, lane: row.lane,
    status: row.status, notes: row.notes, costumes: row.costumes.map((costume) => ({ name: costume.name, status: costume.status, notes: costume.notes })),
  })));
  if (castText) parts.push({ key: "cast", label: "cast", title: "THE NAMED CAST", text: castText });
  const directory = knowledge(ownStories).find((story) => isCastTitle(story.title)) ?? knowledge(universeStories).find((story) => isCastTitle(story.title));
  if (directory?.body.trim()) parts.push({ key: "cast", label: "cast", title: directory.title, text: directory.body });

  const bible = knowledge(ownStories).find((story) => isBibleTitle(story.title)) ?? knowledge(universeStories).find((story) => isBibleTitle(story.title));
  if (bible?.body.trim()) parts.push({ key: "bible", label: "bible", title: bible.title, text: bible.body });

  const books = [...ownChildren, ...universeChildren].filter((child) => child.kind === "storybook" && !/^archived\b/i.test(child.name));
  if (books.length > 0) {
    const stories = [...ownStories, ...universeStories];
    const lines = books.slice(0, 30).map((book) => {
      const story = stories.find((entry) => entry.storybookId === book._id || entry.folderId === book._id);
      const about = (story?.logline ?? book.description ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
      return `- ${book.name}${about ? `: ${about}` : ""}`;
    });
    parts.push({ key: "stories", label: "stories", title: "STORIES ALREADY TOLD IN THIS WORLD (storybooks)", text: lines.join("\n") });
  }

  const universeDocs = shared ? await docsOf(ctx, owner, universe._id) : [];
  const seen = new Set<string>();
  for (const doc of [...docs, ...universeDocs]) {
    if (!doc.path.startsWith("docs/") || !isWorldKnowledgeDoc(doc.path) || seen.has(doc.path) || !doc.body.trim()) continue;
    seen.add(doc.path);
    parts.push({ key: "docs", label: "world notes", title: doc.path, text: doc.body.slice(0, WRITER_BRIEF_LIMITS.doc) });
  }
  return parts;
}

const briefArgs = {
  ownerUserId: v.string(),
  /** A world key, "auto" (read it from the command's codes) or "none". */
  world: v.optional(v.string()),
  /** Used when "auto" finds nothing: the world the user had picked. */
  fallbackWorld: v.optional(v.string()),
  command: v.optional(v.string()),
  /** The Midjourney frame the work grows from (its CDN or job link): a saved frame names its own world. */
  frame: v.optional(v.string()),
  /** A named style (Make it ours): its world is the world. */
  style: v.optional(v.string()),
  tier: v.optional(v.union(v.literal("full"), v.literal("short"))),
};
const briefShape = {
  world: v.union(v.null(), v.object({ key: v.string(), name: v.string() })),
  /** True when the world was found (the saved frame or the codes), false when it was named. */
  auto: v.boolean(),
  /** How it was found: the frame is saved in that world, or its codes point there. */
  by: v.optional(v.union(v.literal("frame"), v.literal("codes"))),
  /** Worlds level on evidence; nothing was picked between them. */
  tie: v.array(v.string()),
  style: v.optional(v.string()),
  read: v.array(v.string()),
  chars: v.number(),
};
type BriefArgs = { ownerUserId: string; world?: string; fallbackWorld?: string; command?: string; frame?: string; style?: string; tier?: BriefTier };

async function buildBrief(ctx: Ctx, args: BriefArgs) {
  const owner = args.ownerUserId;
  const none = { world: null, auto: false, by: undefined as "frame" | "codes" | undefined, tie: [] as string[], style: undefined as string | undefined, read: [] as string[], chars: 0, text: "" };
  const named = async (ref: string | undefined) => {
    const key = ref?.trim();
    if (!key || key === "none" || key === "auto") return null;
    try { return await resolveWorld(ctx, owner, key); } catch { return null; }
  };

  let root: Folder | null = null;
  let style: Doc<"worldStyles"> | null = null;
  let auto = false;
  let by: "frame" | "codes" | undefined;
  let tie: string[] = [];
  // Make it ours names the style itself and lays its lock out in its own
  // message, so the brief leaves the style part to it.
  const styleGiven = Boolean(args.style?.trim());
  if (args.style?.trim()) {
    const id = ctx.db.normalizeId("worldStyles", args.style.trim().replace(/^style:/, ""));
    const row = id ? await ctx.db.get(id) : null;
    if (owned(owner, row)) {
      style = row;
      const world = await ctx.db.get(row.worldFolderId);
      root = owned(owner, world) && world.worldKey ? world : null;
    }
  }
  const wanted = args.world?.trim();
  if (!root && wanted === "auto") {
    const saved = await worldOfFrame(ctx, owner, args.frame);
    if (saved.world) {
      root = saved.world;
      style = saved.style;
      by = "frame";
    } else {
      const found = await worldOfCommand(ctx, owner, args.command);
      root = found.world;
      tie = found.tie;
      if (root) by = "codes";
    }
    auto = Boolean(root);
    if (!root) root = await named(args.fallbackWorld);
  } else if (!root) {
    root = await named(wanted);
  }
  if (!root?.worldKey) return { ...none, tie };

  if (!style) style = await styleOfCommand(ctx, owner, root._id, args.command);
  const brief = composeBrief(root.name, await partsOf(ctx, owner, root, styleGiven ? null : style), args.tier ?? "full");
  return {
    world: { key: root.worldKey, name: root.name }, auto, by, tie: root ? [] : tie, style: style?.name,
    read: brief.read, chars: brief.chars, text: brief.text,
  };
}

/** The brief with its text: for the writer's runner (convex/promptEditRunner.ts). */
export const forWriter = internalQuery({
  args: briefArgs,
  returns: v.object({ ...briefShape, text: v.string() }),
  handler: async (ctx, args) => buildBrief(ctx, args),
});

/** Which world a command belongs to and what would be read: for the card, before it writes. */
export const worldOf = ownerQuery({
  args: briefArgs,
  returns: v.object(briefShape),
  handler: async (ctx, args) => {
    const { text: _text, ...rest } = await buildBrief(ctx, args);
    return rest;
  },
});
