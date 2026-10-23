import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { canonicalFolderName, normalizeFolderName, recountFolderMembers } from "./folderHelpers";
import { canonicalTagKey, normalizeTagName } from "./helpers";
import { replaceAssetTagLinks, resolveTagIdsForNames } from "./assets";
import { syncPublicCollectionMembership } from "./publicCollectionCounts";
import { restoreMoodboardSnapshot, type MoodboardSnapshot } from "./moodboards";
import { restoreProfileSnapshot, type ProfileSnapshot } from "./mjProfiles";
import { restoreStorySnapshot, type StorySnapshot } from "./stories";
import {
  WORLD_KEY_PATTERN, assertSingleWorld, assetFolderIds, childrenOf, cleanSession, listWorldRoots,
  recordWorldChange, resolveWorld, worldKeyFromName, worldRootOfFolder, type JournalMeta, type WorldChangeOp, type WorldMemo,
} from "./worldCore";
import {
  WORLD_DOC_LEARNINGS, WORLD_DOC_LIMITS, WORLD_DOC_MAIN, countLearningEntries, normalizeWorldDocPath, worldDocCapError,
} from "../lib/world-docs";
import { moodboardSyncState, profileFlagForCode, profileFlagForMoodboardId } from "../lib/moodboards";

type Folder = Doc<"folders">;
type Change = Doc<"worldChanges">;

const reindexAssetAction = makeFunctionReference<"action">("semanticIndex:reindexAsset");

const journalArgs = { actor: v.optional(v.string()), session: v.optional(v.string()) };
const meta = (args: JournalMeta): JournalMeta => ({ actor: args.actor, session: cleanSession(args.session) });

const owned = <T extends { ownerUserId?: string }>(owner: string, row: T | null): row is T =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId ?? ""));

/* ── Worlds ──────────────────────────────────────────────────────────────── */

const worldSummaryValidator = v.object({
  worldId: v.id("folders"), key: v.string(), name: v.string(), description: v.optional(v.string()),
  rootCount: v.number(), shelfCount: v.number(), storybookCount: v.number(), hasWorldDoc: v.boolean(),
});

export const listWorlds = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(worldSummaryValidator),
  handler: async (ctx, args) => {
    const roots = await listWorldRoots(ctx, args.ownerUserId);
    const result = [];
    for (const root of roots) {
      const children = await childrenOf(ctx, root._id);
      const doc = await findDoc(ctx, args.ownerUserId, root._id, WORLD_DOC_MAIN);
      result.push({
        worldId: root._id, key: root.worldKey!, name: root.name, description: root.description,
        rootCount: root.memberCount ?? 0,
        shelfCount: children.filter((child) => child.kind === undefined).length,
        storybookCount: children.filter((child) => child.kind === "storybook").length,
        hasWorldDoc: Boolean(doc),
      });
    }
    return result;
  },
});

/** Mark a root collection as a world (or clear the mark). */
export const markWorld = ownerMutation({
  args: {
    ownerUserId: v.string(), folderId: v.id("folders"), worldKey: v.optional(v.union(v.string(), v.null())),
    // A root storybook that is really a world (no children yet) becomes a
    // plain collection first; undo turns it back.
    convertStorybook: v.optional(v.boolean()),
    ...journalArgs,
  },
  returns: v.object({ worldId: v.id("folders"), worldKey: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!owned(args.ownerUserId, folder)) throw new ConvexError("Collection not found.");
    if (folder.parentFolderId) throw new ConvexError("Only a root collection can be a world.");
    const converting = folder.kind === "storybook" && args.worldKey !== null;
    if (converting && !args.convertStorybook) {
      throw new ConvexError(`"${folder.name}" is a storybook. Pass convertStorybook: true to make it a plain world collection.`);
    }
    const next = args.worldKey === null ? undefined : worldKeyFromName(args.worldKey ?? folder.name);
    if (next !== undefined && (!next || !WORLD_KEY_PATTERN.test(next))) throw new ConvexError("A world key is lowercase and hyphenated, like dear-annete.");
    if (next && next !== folder.worldKey) {
      for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
        const clash = await ctx.db.query("folders").withIndex("by_owner_worldKey", (q) => q.eq("ownerUserId", candidate).eq("worldKey", next)).first();
        if (clash && clash._id !== folder._id) throw new ConvexError(`"${clash.name}" already uses the key ${next}.`);
      }
    }
    if (next === folder.worldKey && !converting) return { worldId: folder._id, worldKey: next };
    await ctx.db.patch(folder._id, { worldKey: next, ...(converting ? { kind: undefined } : {}), updatedAt: Date.now() });
    await recordWorldChange(ctx, {
      ownerUserId: args.ownerUserId, worldFolderId: folder._id, op: "world.mark", targetType: "world", targetId: folder._id,
      summary: next ? `Marked "${folder.name}" as world ${next}${converting ? " (was a storybook)" : ""}` : `"${folder.name}" is no longer a world`,
      before: { worldKey: folder.worldKey ?? null, kind: folder.kind ?? null }, after: { worldKey: next ?? null, kind: converting ? null : folder.kind ?? null }, ...meta(args),
    });
    return { worldId: folder._id, worldKey: next };
  },
});

/* ── World context ───────────────────────────────────────────────────────── */

const shelfValidator = v.object({
  id: v.id("folders"), name: v.string(), kind: v.union(v.literal("shelf"), v.literal("storybook")),
  group: v.optional(v.string()), sortOrder: v.optional(v.number()), count: v.number(), description: v.optional(v.string()),
});
const storyRefValidator = v.object({
  id: v.id("stories"), title: v.string(), kind: v.string(), status: v.string(), styleTag: v.optional(v.string()),
  collection: v.string(), storybookId: v.optional(v.id("folders")), revision: v.number(), updatedAt: v.number(), chars: v.number(),
});
const boardValidator = v.object({
  id: v.id("moodboards"), name: v.string(), collection: v.string(), styleTag: v.optional(v.string()), status: v.string(),
  mjCode: v.optional(v.string()), mjMoodboardId: v.optional(v.string()), profileFlag: v.optional(v.string()),
  itemCount: v.number(), mjSyncedItemCount: v.optional(v.number()), sync: v.string(),
  description: v.optional(v.string()), notes: v.optional(v.string()),
});
const profileUseValidator = v.object({
  id: v.id("mjProfiles"), name: v.string(), code: v.string(), flag: v.string(), status: v.string(),
  role: v.string(), styleTag: v.optional(v.string()), mjProfileId: v.optional(v.string()),
});
const changeValidator = v.object({
  id: v.id("worldChanges"), at: v.number(), actor: v.string(), session: v.optional(v.string()), op: v.string(),
  targetType: v.string(), targetId: v.string(), summary: v.string(),
  revertOf: v.optional(v.id("worldChanges")), revertedBy: v.optional(v.id("worldChanges")),
});
const docRefValidator = v.object({ path: v.string(), chars: v.number(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string() });

const toChange = (row: Change) => ({
  id: row._id, at: row.createdAt, actor: row.actor, session: row.session, op: row.op,
  targetType: row.targetType, targetId: row.targetId, summary: row.summary, revertOf: row.revertOf, revertedBy: row.revertedBy,
});

const syncLabel = (board: Doc<"moodboards">, addedAts: number[]) => {
  const state = moodboardSyncState(board, addedAts);
  if (!state.inMidjourney) return "gallery only (not in Midjourney yet)";
  if (!state.synced) return "in Midjourney, never recorded a sync";
  if (state.upToDate) return "in sync";
  return `gallery changed since the last sync: +${state.addedSince} / -${state.removedSince}; update Midjourney, then set_moodboard_midjourney`;
};

export const getWorldContext = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string(), journalLimit: v.optional(v.number()) },
  returns: v.object({
    world: v.object({ id: v.id("folders"), key: v.string(), name: v.string(), description: v.optional(v.string()), rootCount: v.number() }),
    worldDoc: v.union(v.null(), v.object({ body: v.string(), revision: v.number(), updatedAt: v.number() })),
    learnings: v.union(v.null(), v.object({ body: v.string(), revision: v.number(), entries: v.number() })),
    docs: v.array(docRefValidator),
    limits: v.object({ worldDoc: v.number(), learnings: v.number(), learningEntries: v.number(), doc: v.number(), docs: v.number() }),
    styles: v.array(v.object({ styleTag: v.string(), branch: v.optional(v.string()), locks: v.array(storyRefValidator), moodboards: v.number() })),
    shelves: v.array(shelfValidator),
    storybooks: v.array(v.object({ id: v.id("folders"), name: v.string(), count: v.number(), description: v.optional(v.string()), stories: v.array(storyRefValidator) })),
    stories: v.array(storyRefValidator),
    moodboards: v.array(boardValidator),
    profiles: v.array(profileUseValidator),
    characters: v.array(v.object({ id: v.id("characters"), code: v.string(), name: v.string(), status: v.string() })),
    recentChanges: v.array(changeValidator),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const children = (await childrenOf(ctx, root._id)).filter((child) => owned(owner, child));
    const folders = [root, ...children];
    const nameOf = new Map(folders.map((folder) => [folder._id as string, folder.name]));

    const docs = await worldDocsOf(ctx, owner, root._id);
    const main = docs.find((doc) => doc.path === WORLD_DOC_MAIN);
    const learn = docs.find((doc) => doc.path === WORLD_DOC_LEARNINGS);

    const stories: Doc<"stories">[] = [];
    for (const folder of folders) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        stories.push(...await ctx.db.query("stories")
          .withIndex("by_owner_folder_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("folderId", folder._id))
          .order("desc").take(200));
      }
    }
    const storyRef = (story: Doc<"stories">) => ({
      id: story._id, title: story.title, kind: story.kind, status: story.status, styleTag: story.styleTag,
      collection: nameOf.get(story.folderId ?? "") ?? "?", storybookId: story.storybookId,
      revision: story.revision, updatedAt: story.updatedAt, chars: story.body.length,
    });

    const boards: Doc<"moodboards">[] = [];
    for (const folder of folders) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        boards.push(...await ctx.db.query("moodboards")
          .withIndex("by_owner_folder_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("folderId", folder._id)).collect());
      }
    }
    const moodboards = [];
    for (const board of boards) {
      const addedAts = board.mjSyncedAt === undefined ? [] : (await ctx.db.query("moodboardItems")
        .withIndex("by_moodboard_position", (q) => q.eq("moodboardId", board._id)).collect()).map((item) => item.addedAt);
      moodboards.push({
        id: board._id, name: board.name, collection: nameOf.get(board.folderId) ?? "?", styleTag: board.styleTag, status: board.status,
        mjCode: board.mjCode, mjMoodboardId: board.mjMoodboardId,
        profileFlag: board.mjCode ? profileFlagForCode(board.mjCode) : board.mjMoodboardId ? profileFlagForMoodboardId(board.mjMoodboardId) : undefined,
        itemCount: board.itemCount, mjSyncedItemCount: board.mjSyncedItemCount, sync: syncLabel(board, addedAts),
        description: board.description, notes: board.notes,
      });
    }

    const profiles = [];
    for (const candidate of resolveUserIdCandidates(owner)) {
      const rows = await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate)).collect();
      for (const row of rows) {
        for (const use of row.uses.filter((entry) => entry.worldFolderId === root._id)) {
          profiles.push({
            id: row._id, name: row.name, code: row.code, flag: profileFlagForCode(row.code), status: row.status,
            role: use.role, styleTag: use.styleTag, mjProfileId: row.mjProfileId,
          });
        }
      }
    }

    // Styles: every style tag a lock, board or profile names, with its branch.
    const styleTags = new Set<string>();
    for (const story of stories) if (story.kind === "style-lock" && story.styleTag) styleTags.add(story.styleTag);
    for (const board of boards) if (board.styleTag) styleTags.add(board.styleTag);
    const styles = [...styleTags].sort().map((styleTag) => {
      const branchBoards = boards.filter((board) => board.styleTag === styleTag);
      const branchId = branchBoards[0]?.folderId;
      return {
        styleTag,
        branch: branchId && branchId !== root._id ? nameOf.get(branchId) : undefined,
        locks: stories.filter((story) => story.kind === "style-lock" && story.styleTag === styleTag).map(storyRef),
        moodboards: branchBoards.length,
      };
    });

    const shelves = children.filter((child) => child.kind === undefined).map((child) => ({
      id: child._id, name: child.name, kind: "shelf" as const, group: child.group, sortOrder: child.sortOrder,
      count: child.memberCount ?? 0, description: child.description,
    }));
    const storybooks = children.filter((child) => child.kind === "storybook").map((child) => ({
      id: child._id, name: child.name, count: child.memberCount ?? 0, description: child.description?.slice(0, 600),
      stories: stories.filter((story) => story.storybookId === child._id || story.folderId === child._id).map(storyRef),
    }));

    const characters = [];
    for (const candidate of resolveUserIdCandidates(owner)) {
      const rows = await ctx.db.query("characters").withIndex("by_owner_world_number", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", root._id)).collect();
      characters.push(...rows.map((row) => ({ id: row._id, code: row.code, name: row.name, status: row.status })));
    }

    const journalLimit = Math.min(Math.max(args.journalLimit ?? 10, 0), 50);
    const recent = journalLimit === 0 ? [] : await recentChanges(ctx, owner, root._id, journalLimit);

    return {
      world: { id: root._id, key: root.worldKey!, name: root.name, description: root.description, rootCount: root.memberCount ?? 0 },
      worldDoc: main ? { body: main.body, revision: main.revision, updatedAt: main.updatedAt } : null,
      learnings: learn ? { body: learn.body, revision: learn.revision, entries: countLearningEntries(learn.body) } : null,
      docs: docs.map((doc) => ({ path: doc.path, chars: doc.body.length, revision: doc.revision, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy })),
      limits: {
        worldDoc: WORLD_DOC_LIMITS.main, learnings: WORLD_DOC_LIMITS.learnings, learningEntries: WORLD_DOC_LIMITS.learningEntries,
        doc: WORLD_DOC_LIMITS.doc, docs: WORLD_DOC_LIMITS.docs,
      },
      styles, shelves, storybooks,
      stories: stories.filter((story) => story.kind !== "style-lock" && !story.storybookId).map(storyRef),
      moodboards, profiles, characters, recentChanges: recent.map(toChange),
    };
  },
});

/* ── World docs ──────────────────────────────────────────────────────────── */

const worldDocsOf = async (ctx: QueryCtx, owner: string, worldId: Id<"folders">) => {
  const rows: Doc<"worldDocs">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("worldDocs").withIndex("by_owner_world_path", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId)).collect());
  }
  const order = (path: string) => (path === WORLD_DOC_MAIN ? 0 : path === WORLD_DOC_LEARNINGS ? 1 : 2);
  return rows.sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path));
};

const findDoc = async (ctx: QueryCtx, owner: string, worldId: Id<"folders">, path: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("worldDocs").withIndex("by_owner_world_path", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", worldId).eq("path", path)).first();
    if (row) return row;
  }
  return null;
};

const requirePath = (value: string) => {
  const path = normalizeWorldDocPath(value);
  if (!path) throw new ConvexError(`"${value}" is not a world doc path. Use WORLD.md, LEARNINGS.md or docs/<kebab-name>.md.`);
  return path;
};

const docValidator = v.object({
  world: v.string(), path: v.string(), body: v.string(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string(),
});

export const readWorldDoc = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string(), path: v.string() },
  returns: v.union(v.null(), docValidator),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const doc = await findDoc(ctx, args.ownerUserId, root._id, requirePath(args.path));
    return doc ? { world: root.worldKey!, path: doc.path, body: doc.body, revision: doc.revision, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy } : null;
  },
});

export const listWorldDocs = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string() },
  returns: v.array(docValidator),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    return (await worldDocsOf(ctx, args.ownerUserId, root._id)).map((doc) => ({
      world: root.worldKey!, path: doc.path, body: doc.body, revision: doc.revision, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy,
    }));
  },
});

type DocState = { path: string; body: string | null; revision: number };

const writeDoc = async (
  ctx: MutationCtx, owner: string, root: Folder, path: string, body: string | null,
  expectedRevision: number | undefined, note: string | undefined, journal: JournalMeta, op: WorldChangeOp = "doc.write",
  revertOf?: Id<"worldChanges">,
) => {
  const existing = await findDoc(ctx, owner, root._id, path);
  if (expectedRevision !== undefined && expectedRevision !== (existing?.revision ?? 0)) {
    throw new ConvexError(`${path} changed (now revision ${existing?.revision ?? 0}). Read it again before writing.`);
  }
  const before: DocState = { path, body: existing?.body ?? null, revision: existing?.revision ?? 0 };
  const now = Date.now();
  const actor = journal.actor?.trim().slice(0, 80) || "owner";
  if (body === null) {
    if (!existing) return { path, revision: 0, changed: false, changeId: null };
    await ctx.db.delete(existing._id);
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op: op === "doc.write" ? "doc.delete" : op, targetType: "doc", targetId: `${root._id}:${path}`,
      summary: note ? `Deleted ${path}: ${note}` : `Deleted ${path}`, before, after: { path, body: null, revision: 0 }, revertOf, ...journal,
    });
    return { path, revision: 0, changed: true, changeId };
  }
  const clean = body.replace(/\r\n/g, "\n").trimEnd() + "\n";
  if (!clean.trim()) throw new ConvexError("A world doc needs text. To remove it, use action delete.");
  const otherDocs = path.startsWith("docs/") && !existing
    ? (await worldDocsOf(ctx, owner, root._id)).filter((doc) => doc.path.startsWith("docs/")).length
    : 0;
  const capError = worldDocCapError(path, clean, otherDocs);
  if (capError) throw new ConvexError(capError);
  if (existing && existing.body === clean) return { path, revision: existing.revision, changed: false, changeId: null };
  const revision = (existing?.revision ?? 0) + 1;
  if (existing) await ctx.db.patch(existing._id, { body: clean, revision, updatedBy: actor, updatedAt: now });
  else await ctx.db.insert("worldDocs", { ownerUserId: owner, worldFolderId: root._id, path, body: clean, revision, updatedBy: actor, createdAt: now, updatedAt: now });
  const verb = existing ? "Edited" : "Created";
  const changeId = await recordWorldChange(ctx, {
    ownerUserId: owner, worldFolderId: root._id, op, targetType: "doc", targetId: `${root._id}:${path}`,
    summary: note ? `${verb} ${path}: ${note}` : `${verb} ${path} (${clean.length} chars)`,
    before, after: { path, body: clean, revision }, revertOf, ...journal,
  });
  return { path, revision, changed: true, changeId };
};

const docWriteResult = v.object({ path: v.string(), revision: v.number(), changed: v.boolean(), changeId: v.union(v.null(), v.id("worldChanges")) });

export const writeWorldDoc = ownerMutation({
  args: {
    ownerUserId: v.string(), world: v.string(), path: v.string(), body: v.string(),
    expectedRevision: v.optional(v.number()), note: v.optional(v.string()), ...journalArgs,
  },
  returns: docWriteResult,
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const note = args.note?.trim().slice(0, WORLD_DOC_LIMITS.note) || undefined;
    return writeDoc(ctx, args.ownerUserId, root, requirePath(args.path), args.body, args.expectedRevision, note, meta(args));
  },
});

export const deleteWorldDoc = ownerMutation({
  args: { ownerUserId: v.string(), world: v.string(), path: v.string(), expectedRevision: v.optional(v.number()), note: v.optional(v.string()), ...journalArgs },
  returns: docWriteResult,
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const path = requirePath(args.path);
    if (path === WORLD_DOC_MAIN) throw new ConvexError("WORLD.md is the world's main file; edit it instead of deleting it.");
    return writeDoc(ctx, args.ownerUserId, root, path, null, args.expectedRevision, args.note?.trim().slice(0, WORLD_DOC_LIMITS.note), meta(args));
  },
});

/** Every saved version of one doc, newest first, from the journal. */
export const worldDocHistory = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string(), path: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({
    changeId: v.id("worldChanges"), at: v.number(), actor: v.string(), summary: v.string(), revision: v.number(),
    body: v.union(v.null(), v.string()), revertedBy: v.optional(v.id("worldChanges")),
  })),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const path = requirePath(args.path);
    const rows: Change[] = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await ctx.db.query("worldChanges")
        .withIndex("by_owner_target_createdAt", (q) => q.eq("ownerUserId", candidate).eq("targetId", `${root._id}:${path}`))
        .order("desc").take(Math.min(Math.max(args.limit ?? 20, 1), 100)));
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt).map((row) => {
      const after = row.after ? JSON.parse(row.after) as DocState : { body: null, revision: 0 };
      return { changeId: row._id, at: row.createdAt, actor: row.actor, summary: row.summary, revision: after.revision, body: after.body, revertedBy: row.revertedBy };
    });
  },
});

/* ── Filing ──────────────────────────────────────────────────────────────── */

const MAX_FILE_ASSETS = 100;

type FileState = { assetId: Id<"assets">; folderIds: Id<"folders">[]; primary: Id<"folders"> | null; tagIds: Id<"tags">[] };

const setsEqual = <T>(a: Iterable<T>, b: Iterable<T>) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
};

/** Apply a whole folder set and tag set to one asset; returns touched folders. */
const applyFileState = async (ctx: MutationCtx, asset: Doc<"assets">, next: FileState) => {
  const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).collect();
  const want = new Set(next.folderIds);
  const touched = new Set<Id<"folders">>();
  for (const link of links) {
    if (!want.has(link.folderId)) {
      await ctx.db.delete(link._id);
      touched.add(link.folderId);
    }
  }
  const have = new Set(links.map((link) => link.folderId));
  for (const folderId of want) {
    if (have.has(folderId)) continue;
    await ctx.db.insert("assetFolders", { ownerUserId: asset.ownerUserId ?? "", assetId: asset._id, folderId, createdAt: Date.now() });
    touched.add(folderId);
  }
  const primary = next.primary && want.has(next.primary) ? next.primary : next.folderIds[0];
  const patch: Partial<Doc<"assets">> = {};
  if (asset.folderId !== primary) patch.folderId = primary;
  if (!setsEqual(asset.tagIds, next.tagIds)) {
    await replaceAssetTagLinks(ctx, asset, next.tagIds);
    patch.tagIds = next.tagIds;
    await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId: asset._id });
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(asset._id, patch);
  return touched;
};

// The legacy primary pointer counts as a membership even without a link row,
// so refiling never drops it silently (applyFileState writes the row).
const stateOf = async (ctx: QueryCtx, asset: Doc<"assets">): Promise<FileState> => ({
  assetId: asset._id, folderIds: await assetFolderIds(ctx, asset), primary: asset.folderId ?? null, tagIds: [...asset.tagIds],
});

/** Existing tags by name; unknown names are skipped, never created. */
const existingTagIds = async (ctx: QueryCtx, names: string[]) => {
  const ids = new Set<Id<"tags">>();
  for (const name of names) {
    const normalized = normalizeTagName(name);
    const canonical = canonicalTagKey(name);
    const tag = (normalized ? await ctx.db.query("tags").withIndex("by_normalized", (q) => q.eq("normalized", normalized)).first() : null)
      ?? (canonical ? await ctx.db.query("tags").withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", canonical)).first() : null);
    if (tag) ids.add(tag._id);
  }
  return ids;
};

const resolveShelf = (root: Folder, children: Folder[], ref: string) => {
  const value = ref.trim().replace(/^(folder|collection|shelf|storybook):/, "");
  const lower = value.toLowerCase();
  if (value === root._id || lower === root.name.toLowerCase() || lower === "root" || lower === root.worldKey) return root;
  const hit = children.find((child) => child._id === value)
    ?? children.find((child) => child.name.toLowerCase() === lower);
  if (!hit) throw new ConvexError(`"${ref}" is not a shelf of ${root.name}. Its shelves: ${children.map((child) => child.name).join(", ")}.`);
  return hit;
};

export const fileWorldAssets = ownerMutation({
  args: {
    ownerUserId: v.string(), world: v.string(),
    assetIds: v.array(v.id("assets")),
    // Shelves of this world (name or id; "root" is the world collection itself).
    addTo: v.optional(v.array(v.string())),
    removeFrom: v.optional(v.array(v.string())),
    addTags: v.optional(v.array(v.string())),
    removeTags: v.optional(v.array(v.string())),
    // Take the assets out of every other world first (journaled with the rest).
    move: v.optional(v.boolean()),
    note: v.optional(v.string()),
    ...journalArgs,
  },
  returns: v.object({
    changeId: v.union(v.null(), v.id("worldChanges")), changed: v.number(), unchanged: v.number(),
    results: v.array(v.object({ assetId: v.id("assets"), folders: v.array(v.string()), tags: v.number(), changed: v.boolean() })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const ids = [...new Set(args.assetIds)];
    if (ids.length === 0) throw new ConvexError("Send at least one asset.");
    if (ids.length > MAX_FILE_ASSETS) throw new ConvexError(`File at most ${MAX_FILE_ASSETS} assets per call.`);
    const root = await resolveWorld(ctx, owner, args.world);
    const children = (await childrenOf(ctx, root._id)).filter((child) => owned(owner, child));
    const addTo = (args.addTo ?? []).map((ref) => resolveShelf(root, children, ref)._id);
    const removeFrom = new Set((args.removeFrom ?? []).map((ref) => resolveShelf(root, children, ref)._id));
    const addTagIds = await resolveTagIdsForNames(ctx, args.addTags ?? [], undefined);
    const removeTagIds = await existingTagIds(ctx, args.removeTags ?? []);
    if (addTo.length === 0 && removeFrom.size === 0 && addTagIds.length === 0 && removeTagIds.size === 0) {
      throw new ConvexError("Nothing to do: give addTo, removeFrom, addTags or removeTags.");
    }

    const befores: FileState[] = [];
    const afters: FileState[] = [];
    const results = [];
    const touched = new Set<Id<"folders">>();
    const memo: WorldMemo = new Map();
    for (const assetId of ids) {
      const asset = await ctx.db.get(assetId);
      if (!owned(owner, asset)) throw new ConvexError(`Asset not found: asset:${assetId}`);
      const before = await stateOf(ctx, asset);
      let folderIds = before.folderIds.filter((id) => !removeFrom.has(id));
      if (args.move) {
        const kept: Id<"folders">[] = [];
        for (const id of folderIds) {
          const world = await worldRootOfFolder(ctx, id, memo);
          if (!world || world._id === root._id) kept.push(id);
        }
        folderIds = kept;
      }
      folderIds = [...new Set([...folderIds, ...addTo])];
      await assertSingleWorld(ctx, asset, before.folderIds, folderIds, memo);
      const tagIds = [...new Set([...before.tagIds.filter((id) => !removeTagIds.has(id)), ...addTagIds])];
      const after: FileState = { assetId, folderIds, primary: folderIds.includes(before.primary as Id<"folders">) ? before.primary : folderIds[0] ?? null, tagIds };
      const changed = !setsEqual(before.folderIds, after.folderIds) || !setsEqual(before.tagIds, after.tagIds);
      if (changed) {
        for (const id of await applyFileState(ctx, asset, after)) touched.add(id);
        befores.push(before);
        afters.push(after);
      }
      const names = folderIds.map((id) => (id === root._id ? root.name : children.find((child) => child._id === id)?.name ?? id));
      results.push({ assetId, folders: names, tags: tagIds.length, changed });
    }
    await recountFolderMembers(ctx, touched);
    for (const state of afters) await syncPublicCollectionMembership(ctx, state.assetId);
    if (afters.length === 0) return { changeId: null, changed: 0, unchanged: results.length, results };
    const parts = [
      addTo.length ? `into ${addTo.map((id) => (id === root._id ? root.name : children.find((c) => c._id === id)?.name)).join(", ")}` : "",
      removeFrom.size ? `out of ${[...removeFrom].map((id) => (id === root._id ? root.name : children.find((c) => c._id === id)?.name)).join(", ")}` : "",
      args.move ? "moved out of other worlds" : "",
      addTagIds.length ? `+tags ${(args.addTags ?? []).join(", ")}` : "",
      removeTagIds.size ? `-tags ${(args.removeTags ?? []).join(", ")}` : "",
    ].filter(Boolean).join("; ");
    const note = args.note?.trim().slice(0, 200);
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op: "assets.file", targetType: "assets", targetId: `${root._id}:assets`,
      summary: `Filed ${afters.length} asset${afters.length === 1 ? "" : "s"} ${parts}${note ? ` (${note})` : ""}`,
      before: befores, after: afters, ...meta(args),
    });
    return { changeId, changed: afters.length, unchanged: results.length - afters.length, results };
  },
});

/* ── Shelves and storybooks ──────────────────────────────────────────────── */

type ShelfState = {
  folderId: Id<"folders">; name: string; normalizedName?: string; description?: string; group?: string;
  sortOrder?: number; parentFolderId?: Id<"folders">; kind?: "storybook";
};

const shelfState = (folder: Folder): ShelfState => ({
  folderId: folder._id, name: folder.name, normalizedName: folder.normalizedName, description: folder.description,
  group: folder.group, sortOrder: folder.sortOrder, parentFolderId: folder.parentFolderId, kind: folder.kind,
});

const scopedName = (name: string, parent: Id<"folders"> | undefined) =>
  parent ? `${parent}/${canonicalFolderName(name)}` : canonicalFolderName(name);

const assertNameFree = async (ctx: QueryCtx, owner: string, normalizedName: string, self?: Id<"folders">) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const clash = await ctx.db.query("folders").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("normalizedName", normalizedName)).first();
    if (clash && clash._id !== self) throw new ConvexError(`A collection named "${clash.name}" already exists there.`);
  }
};

export const saveWorldShelf = ownerMutation({
  args: {
    ownerUserId: v.string(), world: v.string(),
    // Omit to create; give a shelf (name or id) to change it, or any root
    // collection's id to bring it into this world as a shelf or storybook.
    shelf: v.optional(v.string()),
    name: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("shelf"), v.literal("storybook"))),
    description: v.optional(v.union(v.string(), v.null())),
    group: v.optional(v.union(v.string(), v.null())),
    sortOrder: v.optional(v.union(v.number(), v.null())),
    ...journalArgs,
  },
  returns: v.object({ shelfId: v.id("folders"), created: v.boolean(), changeId: v.union(v.null(), v.id("worldChanges")) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const root = await resolveWorld(ctx, owner, args.world);
    const children = (await childrenOf(ctx, root._id)).filter((child) => owned(owner, child));
    const group = args.group === null ? undefined : args.group?.trim().slice(0, 40) || undefined;
    const description = args.description === null ? undefined : args.description?.trim() || undefined;
    if (description && description.length > 4000) throw new ConvexError("A shelf description is limited to 4,000 characters.");
    const now = Date.now();

    if (!args.shelf) {
      const name = normalizeFolderName(args.name ?? "");
      if (!name) throw new ConvexError("A new shelf needs a name.");
      const normalizedName = scopedName(name, root._id);
      await assertNameFree(ctx, owner, normalizedName);
      const kind = args.kind === "storybook" ? "storybook" as const : undefined;
      const shelfId = await ctx.db.insert("folders", {
        ownerUserId: owner, name, normalizedName, description, kind, parentFolderId: root._id,
        group: group ?? (kind ? "Storybooks" : undefined), sortOrder: args.sortOrder ?? undefined, memberCount: 0, createdAt: now, updatedAt: now,
      });
      const changeId = await recordWorldChange(ctx, {
        ownerUserId: owner, worldFolderId: root._id, op: "shelf.create", targetType: kind ? "storybook" : "shelf", targetId: shelfId,
        summary: `Created ${kind ? "storybook" : "shelf"} "${name}"${group ? ` in ${group}` : ""}`, after: { folderId: shelfId }, ...meta(args),
      });
      return { shelfId, created: true, changeId };
    }

    // An existing shelf, or a root collection being brought into the world.
    const ref = args.shelf.trim().replace(/^(folder|collection|shelf|storybook):/, "");
    const foreignId = ctx.db.normalizeId("folders", ref);
    const foreign = foreignId ? await ctx.db.get(foreignId) : null;
    const folder = foreign && owned(owner, foreign) && !foreign.parentFolderId && foreign._id !== root._id
      ? foreign
      : resolveShelf(root, children, args.shelf);
    if (folder._id === root._id) throw new ConvexError("That is the world itself; edit shelves inside it.");
    if (folder.worldKey) throw new ConvexError(`"${folder.name}" is a world of its own and cannot become a shelf.`);
    if (!folder.parentFolderId) {
      const grandchildren = await childrenOf(ctx, folder._id);
      if (grandchildren.length > 0) throw new ConvexError(`"${folder.name}" holds sub-collections and cannot move inside a world.`);
    }
    if (args.kind && args.kind !== (folder.kind === "storybook" ? "storybook" : "shelf")) {
      throw new ConvexError("A shelf and a storybook keep their kind; create a new one instead.");
    }
    const before = shelfState(folder);
    const name = args.name === undefined ? folder.name : normalizeFolderName(args.name);
    if (!name) throw new ConvexError("A shelf needs a name.");
    const normalizedName = scopedName(name, root._id);
    if (normalizedName !== folder.normalizedName) await assertNameFree(ctx, owner, normalizedName, folder._id);
    const patch = {
      name, normalizedName, parentFolderId: root._id,
      description: args.description === undefined ? folder.description : description,
      group: args.group === undefined ? (folder.group ?? (folder.kind === "storybook" && !folder.parentFolderId ? "Storybooks" : undefined)) : group,
      sortOrder: args.sortOrder === undefined ? folder.sortOrder : args.sortOrder ?? undefined,
      // A folder inside a world is published only through its world.
      ...(folder.parentFolderId ? {} : { showcased: undefined, showcaseFeatured: undefined }),
      updatedAt: now,
    };
    const after: ShelfState = { ...before, ...patch, folderId: folder._id };
    if (JSON.stringify({ ...before }) === JSON.stringify(shelfState({ ...folder, ...patch } as Folder))) {
      return { shelfId: folder._id, created: false, changeId: null };
    }
    await ctx.db.patch(folder._id, patch);
    // Stories that pointed at the moved storybook follow it into the world.
    const changeId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op: "shelf.update", targetType: folder.kind === "storybook" ? "storybook" : "shelf", targetId: folder._id,
      summary: folder.parentFolderId
        ? `Updated ${folder.kind === "storybook" ? "storybook" : "shelf"} "${name}"${name !== folder.name ? ` (was "${folder.name}")` : ""}`
        : `Brought "${folder.name}" into ${root.name}${name !== folder.name ? ` as "${name}"` : ""}`,
      before: { ...before, showcased: folder.showcased, showcaseFeatured: folder.showcaseFeatured }, after, ...meta(args),
    });
    return { shelfId: folder._id, created: false, changeId };
  },
});

/* ── Journal ─────────────────────────────────────────────────────────────── */

const recentChanges = async (ctx: QueryCtx, owner: string, worldId: Id<"folders">, limit: number, before?: number) => {
  const rows: Change[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    rows.push(...await ctx.db.query("worldChanges")
      .withIndex("by_owner_world_createdAt", (q) => {
        const range = q.eq("ownerUserId", candidate).eq("worldFolderId", worldId);
        return before === undefined ? range : range.lt("createdAt", before);
      })
      .order("desc").take(limit));
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
};

export const listWorldChanges = ownerQuery({
  args: {
    ownerUserId: v.string(), world: v.optional(v.string()), session: v.optional(v.string()),
    // Page back with the `at` of the oldest change already read.
    before: v.optional(v.number()), limit: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(v.object({ ...changeValidator.fields, world: v.string() })),
    nextBefore: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    const owner = args.ownerUserId;
    let rows: Change[] = [];
    if (args.session?.trim()) {
      for (const candidate of resolveUserIdCandidates(owner)) {
        rows.push(...await ctx.db.query("worldChanges")
          .withIndex("by_owner_session_createdAt", (q) => {
            const range = q.eq("ownerUserId", candidate).eq("session", cleanSession(args.session));
            return args.before === undefined ? range : range.lt("createdAt", args.before);
          })
          .order("desc").take(limit));
      }
      rows = rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
      if (args.world) {
        const root = await resolveWorld(ctx, owner, args.world);
        rows = rows.filter((row) => row.worldFolderId === root._id);
      }
    } else if (args.world) {
      const root = await resolveWorld(ctx, owner, args.world);
      rows = await recentChanges(ctx, owner, root._id, limit, args.before);
    } else {
      for (const root of await listWorldRoots(ctx, owner)) rows.push(...await recentChanges(ctx, owner, root._id, limit, args.before));
      rows = rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    }
    const names = new Map<string, string>();
    for (const row of rows) {
      if (!names.has(row.worldFolderId)) names.set(row.worldFolderId, (await ctx.db.get(row.worldFolderId))?.worldKey ?? row.worldFolderId);
    }
    return {
      changes: rows.map((row) => ({ ...toChange(row), world: names.get(row.worldFolderId)! })),
      nextBefore: rows.length === limit ? rows[rows.length - 1]!.createdAt : undefined,
    };
  },
});

export const getWorldChange = ownerQuery({
  args: { ownerUserId: v.string(), changeId: v.id("worldChanges") },
  returns: v.object({ ...changeValidator.fields, world: v.string(), before: v.optional(v.string()), after: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.changeId);
    if (!owned(args.ownerUserId, row)) throw new ConvexError("Change not found.");
    const world = await ctx.db.get(row.worldFolderId);
    return { ...toChange(row), world: world?.worldKey ?? row.worldFolderId, before: row.before, after: row.after };
  },
});

/* ── Undo ────────────────────────────────────────────────────────────────── */

type RevertOutcome = { ok: true; summary: string } | { ok: false; reason: string };

const parse = <T>(text: string | undefined): T | null => (text ? JSON.parse(text) as T : null);

/** Check whether a change can still be reverted, and do it unless dryRun. */
const revertChange = async (ctx: MutationCtx, owner: string, change: Change, dryRun: boolean, journal: JournalMeta): Promise<RevertOutcome> => {
  if (change.revertedBy) return { ok: false, reason: "already undone" };
  const root = await ctx.db.get(change.worldFolderId);
  if (!root) return { ok: false, reason: "its world no longer exists" };
  const record = async (summary: string, before: unknown, after: unknown, op: WorldChangeOp = change.op as WorldChangeOp, targetId = change.targetId) => {
    const undoId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op, targetType: change.targetType, targetId,
      summary: `Undo: ${summary}`, before, after, revertOf: change._id, ...journal,
    });
    await ctx.db.patch(change._id, { revertedBy: undoId });
    return undoId;
  };

  switch (change.op) {
    case "doc.write":
    case "doc.delete": {
      const before = parse<DocState>(change.before)!;
      const after = parse<DocState>(change.after)!;
      const current = await findDoc(ctx, owner, root._id, after.path);
      if ((current?.revision ?? 0) !== after.revision || (current?.body ?? null) !== after.body) {
        return { ok: false, reason: `${after.path} changed since (now revision ${current?.revision ?? 0}); undo the later change first` };
      }
      if (dryRun) return { ok: true, summary: change.summary };
      const now = Date.now();
      const actor = journal.actor?.trim().slice(0, 80) || "owner";
      let restored: DocState;
      if (before.body === null) {
        if (current) await ctx.db.delete(current._id);
        restored = { path: after.path, body: null, revision: 0 };
      } else if (current) {
        restored = { path: after.path, body: before.body, revision: current.revision + 1 };
        await ctx.db.patch(current._id, { body: before.body, revision: restored.revision, updatedBy: actor, updatedAt: now });
      } else {
        restored = { path: after.path, body: before.body, revision: 1 };
        await ctx.db.insert("worldDocs", { ownerUserId: owner, worldFolderId: root._id, path: after.path, body: before.body, revision: 1, updatedBy: actor, createdAt: now, updatedAt: now });
      }
      await record(change.summary, after, restored, restored.body === null ? "doc.delete" : "doc.write");
      return { ok: true, summary: change.summary };
    }
    case "assets.file": {
      const before = parse<FileState[]>(change.before) ?? [];
      const after = parse<FileState[]>(change.after) ?? [];
      const conflicts: string[] = [];
      const assets: Doc<"assets">[] = [];
      for (const state of after) {
        const asset = await ctx.db.get(state.assetId);
        if (!asset) { conflicts.push(`asset:${state.assetId} is gone`); continue; }
        const now = await stateOf(ctx, asset);
        if (!setsEqual(now.folderIds, state.folderIds) || !setsEqual(now.tagIds, state.tagIds)) conflicts.push(`asset:${state.assetId} was refiled since`);
        assets.push(asset);
      }
      if (conflicts.length > 0) return { ok: false, reason: conflicts.slice(0, 5).join("; ") };
      if (dryRun) return { ok: true, summary: change.summary };
      const touched = new Set<Id<"folders">>();
      for (const [index, asset] of assets.entries()) {
        const target = before.find((state) => state.assetId === asset._id) ?? before[index]!;
        for (const id of await applyFileState(ctx, asset, target)) touched.add(id);
      }
      await recountFolderMembers(ctx, touched);
      for (const asset of assets) await syncPublicCollectionMembership(ctx, asset._id);
      await record(change.summary, after, before);
      return { ok: true, summary: change.summary };
    }
    case "shelf.create": {
      const folderId = parse<{ folderId: Id<"folders"> }>(change.after)?.folderId;
      const folder = folderId ? await ctx.db.get(folderId) : null;
      if (!folder) return { ok: false, reason: "the shelf is already gone" };
      const link = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", folder._id)).first();
      const board = await ctx.db.query("moodboards").withIndex("by_owner_folder_normalizedName", (q) => q.eq("ownerUserId", folder.ownerUserId ?? owner).eq("folderId", folder._id)).first();
      const story = await ctx.db.query("stories").withIndex("by_owner_folder_updatedAt", (q) => q.eq("ownerUserId", folder.ownerUserId ?? owner).eq("folderId", folder._id)).first();
      if (link || board || story) return { ok: false, reason: `"${folder.name}" holds pieces, boards or stories now; move them out first` };
      if (dryRun) return { ok: true, summary: change.summary };
      await ctx.db.delete(folder._id);
      await record(change.summary, { folderId: folder._id }, null);
      return { ok: true, summary: change.summary };
    }
    case "shelf.update": {
      const before = parse<ShelfState & { showcased?: boolean; showcaseFeatured?: boolean }>(change.before)!;
      const after = parse<ShelfState>(change.after)!;
      const folder = await ctx.db.get(before.folderId);
      if (!folder) return { ok: false, reason: "the shelf is gone" };
      const now = shelfState(folder);
      if (now.name !== after.name || now.parentFolderId !== after.parentFolderId || now.group !== after.group || now.description !== after.description || now.sortOrder !== after.sortOrder) {
        return { ok: false, reason: `"${folder.name}" changed since` };
      }
      if (before.normalizedName && before.normalizedName !== folder.normalizedName) await assertNameFree(ctx, owner, before.normalizedName, folder._id);
      if (dryRun) return { ok: true, summary: change.summary };
      await ctx.db.patch(folder._id, {
        name: before.name, normalizedName: before.normalizedName, description: before.description, group: before.group,
        sortOrder: before.sortOrder, parentFolderId: before.parentFolderId, showcased: before.showcased, showcaseFeatured: before.showcaseFeatured,
        updatedAt: Date.now(),
      });
      await record(change.summary, after, before);
      return { ok: true, summary: change.summary };
    }
    case "world.mark": {
      const before = parse<{ worldKey: string | null; kind?: "storybook" | null }>(change.before)!;
      const after = parse<{ worldKey: string | null; kind?: "storybook" | null }>(change.after)!;
      if ((root.worldKey ?? null) !== after.worldKey) return { ok: false, reason: "the world key changed since" };
      if (before.kind === "storybook" && (await childrenOf(ctx, root._id)).length > 0) {
        return { ok: false, reason: `"${root.name}" holds shelves now and cannot turn back into a storybook` };
      }
      if (dryRun) return { ok: true, summary: change.summary };
      await ctx.db.patch(root._id, { worldKey: before.worldKey ?? undefined, ...(before.kind === "storybook" ? { kind: "storybook" as const } : {}) });
      await record(change.summary, after, before);
      return { ok: true, summary: change.summary };
    }
    case "moodboard.create":
    case "moodboard.update":
    case "moodboard.items":
    case "moodboard.delete": {
      const before = parse<MoodboardSnapshot>(change.before);
      const after = parse<MoodboardSnapshot>(change.after);
      const outcome = await restoreMoodboardSnapshot(ctx, owner, change.targetId as Id<"moodboards">, before, after, dryRun);
      if (!outcome.ok) return outcome;
      // A deleted board comes back under a new id; the undo entry names it.
      if (!dryRun) await record(change.summary, after, outcome.restored, change.op as WorldChangeOp, outcome.restored?.moodboardId ?? change.targetId);
      return { ok: true, summary: change.summary };
    }
    case "profile.save": {
      const before = parse<ProfileSnapshot>(change.before);
      const after = parse<ProfileSnapshot>(change.after);
      const outcome = await restoreProfileSnapshot(ctx, owner, change.targetId as Id<"mjProfiles">, before, after, dryRun);
      if (!outcome.ok) return outcome;
      if (!dryRun) await record(change.summary, after, outcome.restored);
      return { ok: true, summary: change.summary };
    }
    case "story.save": {
      const before = parse<StorySnapshot>(change.before);
      const after = parse<StorySnapshot>(change.after)!;
      const outcome = await restoreStorySnapshot(ctx, owner, change.targetId as Id<"stories">, before, after, dryRun);
      if (!outcome.ok) return outcome;
      if (!dryRun) await record(change.summary, after, outcome.restored);
      return { ok: true, summary: change.summary };
    }
    default:
      return { ok: false, reason: `${change.op} cannot be undone` };
  }
};

const undoResult = v.object({
  dryRun: v.boolean(),
  undone: v.array(v.object({ changeId: v.id("worldChanges"), summary: v.string() })),
  blocked: v.array(v.object({ changeId: v.id("worldChanges"), summary: v.string(), reason: v.string() })),
});

export const undoWorldChanges = ownerMutation({
  args: {
    ownerUserId: v.string(),
    // One change, or every change of a session (newest first).
    changeId: v.optional(v.id("worldChanges")),
    undoSession: v.optional(v.string()),
    world: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    ...journalArgs,
  },
  returns: undoResult,
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const dryRun = args.dryRun ?? false;
    let changes: Change[] = [];
    if (args.changeId) {
      const row = await ctx.db.get(args.changeId);
      if (!owned(owner, row)) throw new ConvexError("Change not found.");
      changes = [row];
    } else if (args.undoSession?.trim()) {
      const session = cleanSession(args.undoSession);
      for (const candidate of resolveUserIdCandidates(owner)) {
        changes.push(...await ctx.db.query("worldChanges")
          .withIndex("by_owner_session_createdAt", (q) => q.eq("ownerUserId", candidate).eq("session", session))
          .order("desc").take(200));
      }
      if (args.world) {
        const root = await resolveWorld(ctx, owner, args.world);
        changes = changes.filter((row) => row.worldFolderId === root._id);
      }
      changes = changes.filter((row) => !row.revertedBy && !row.revertOf).sort((a, b) => b.createdAt - a.createdAt);
      if (changes.length === 0) throw new ConvexError(`Nothing to undo in session "${session}".`);
    } else {
      throw new ConvexError("Give a changeId, or undoSession to undo a whole session.");
    }
    const undone = [];
    const blocked = [];
    // A session is undone newest first; a blocked change stops the older
    // ones that may depend on it, so the world never ends up half-reverted.
    let stop = false;
    for (const change of changes) {
      if (stop) { blocked.push({ changeId: change._id, summary: change.summary, reason: "a later change in the session could not be undone" }); continue; }
      const outcome = await revertChange(ctx, owner, change, dryRun, meta(args));
      if (outcome.ok) undone.push({ changeId: change._id, summary: change.summary });
      else { blocked.push({ changeId: change._id, summary: change.summary, reason: outcome.reason }); stop = changes.length > 1; }
    }
    return { dryRun, undone, blocked };
  },
});

/* ── Lookups for the API route ───────────────────────────────────────────── */

export const resolveWorldRef = ownerQuery({
  args: { ownerUserId: v.string(), world: v.string() },
  returns: v.object({ worldId: v.id("folders"), key: v.string(), name: v.string(), folderIds: v.array(v.id("folders")) }),
  handler: async (ctx, args) => {
    const root = await resolveWorld(ctx, args.ownerUserId, args.world);
    const children = (await childrenOf(ctx, root._id)).filter((child) => owned(args.ownerUserId, child));
    return { worldId: root._id, key: root.worldKey!, name: root.name, folderIds: [root._id, ...children.map((child) => child._id)] };
  },
});

export const worldsOfAssets = ownerQuery({
  args: { ownerUserId: v.string(), assetIds: v.array(v.id("assets")) },
  returns: v.array(v.object({ assetId: v.id("assets"), worlds: v.array(v.string()) })),
  handler: async (ctx, args) => {
    const out = [];
    for (const assetId of args.assetIds.slice(0, 200)) {
      const asset = await ctx.db.get(assetId);
      if (!owned(args.ownerUserId, asset)) continue;
      const keys = new Set<string>();
      for (const folderId of await assetFolderIds(ctx, asset)) {
        const world = await worldRootOfFolder(ctx, folderId);
        if (world?.worldKey) keys.add(world.worldKey);
      }
      out.push({ assetId, worlds: [...keys] });
    }
    return out;
  },
});
