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
import { restoreMoodboardSnapshot, snapshotMoodboard, type MoodboardSnapshot } from "./moodboards";
import { restoreProfileSnapshot, type ProfileSnapshot } from "./mjProfiles";
import { restoreStorySnapshot, type StorySnapshot } from "./stories";
import {
  WORLD_KEY_PATTERN, assertMembersFitWorld, assertSingleWorld, assetFolderIds, childrenOf, cleanSession, listWorldRoots,
  recordWorldChange, resolveWorld, worldIdOfFolder, worldKeyFromName, worldRootOfFolder, type JournalMeta, type WorldChangeOp, type WorldMemo,
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
    if (next && !folder.worldKey) {
      await assertMembersFitWorld(ctx, folder._id, null, `"${folder.name}" cannot become a world`);
      for (const child of await childrenOf(ctx, folder._id)) await assertMembersFitWorld(ctx, child._id, null, `Its shelf "${child.name}"`);
    }
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
    otherLocks: v.array(v.object({ id: v.id("stories"), title: v.string(), status: v.string(), styleTag: v.optional(v.string()) })),
    storyCount: v.number(),
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
      });
    }

    const profiles = [];
    for (const candidate of resolveUserIdCandidates(owner)) {
      const rows = await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate)).collect();
      for (const row of rows.filter((profile) => profile.status === "active")) {
        for (const use of row.uses.filter((entry) => entry.worldFolderId === root._id)) {
          profiles.push({
            id: row._id, name: row.name, code: row.code, flag: profileFlagForCode(row.code), status: row.status,
            role: use.role, styleTag: use.styleTag, mjProfileId: row.mjProfileId,
          });
        }
      }
    }

    // Styles: every style tag a lock, board or profile names, with its branch.
    // A style is a style tag that has a moodboard; other locks are listed
    // apart so retired lanes do not read as live styles.
    const styleTags = new Set<string>();
    for (const board of boards) if (board.styleTag) styleTags.add(board.styleTag);
    const otherLocks = stories
      .filter((story) => story.kind === "style-lock" && (!story.styleTag || !styleTags.has(story.styleTag)))
      .map((story) => ({ id: story._id, title: story.title, status: story.status, styleTag: story.styleTag }));
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
      count: child.memberCount ?? 0,
    }));
    const storybooks = children.filter((child) => child.kind === "storybook").map((child) => ({
      id: child._id, name: child.name, count: child.memberCount ?? 0, description: child.description?.slice(0, 200),
      stories: stories.filter((story) => story.storybookId === child._id || story.folderId === child._id).map(storyRef),
    }));

    const characters = [];
    for (const candidate of resolveUserIdCandidates(owner)) {
      const rows = await ctx.db.query("characters").withIndex("by_owner_world_number", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", root._id)).collect();
      characters.push(...rows.map((row) => ({ id: row._id, code: row.code, name: row.name, status: row.status })));
    }

    const journalLimit = Math.min(Math.max(args.journalLimit ?? 5, 0), 50);
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
      styles, otherLocks, shelves, storybooks,
      // The 25 newest loose stories; list_stories with world reads them all.
      storyCount: stories.filter((story) => story.kind !== "style-lock" && !story.storybookId).length,
      stories: stories.filter((story) => story.kind !== "style-lock" && !story.storybookId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 25).map(storyRef),
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
  if (existing && expectedRevision === undefined && op === "doc.write" && body !== null) {
    throw new ConvexError(`${path} exists (revision ${existing.revision}). Read it and pass expectedRevision, so nobody's edit is overwritten.`);
  }
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
    // New tag names are refused unless this is set: reuse the vocabulary.
    createTags: v.optional(v.boolean()),
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
    if (!args.createTags) {
      const unknown: string[] = [];
      for (const name of args.addTags ?? []) if ((await existingTagIds(ctx, [name])).size === 0) unknown.push(name);
      if (unknown.length > 0) throw new ConvexError(`Unknown tags: ${unknown.join(", ")}. Reuse existing tags (list_tags), or pass createTags: true when a new one is needed.`);
    }
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
      await assertMembersFitWorld(ctx, folder._id, root._id, `"${folder.name}" cannot join ${root.name}`);
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

/* ── Moving a shelf, storybook or moodboard to another world ─────────────── */

// The ordinary edit paths (update_collection, save_moodboard) refuse to cross
// a world boundary, so nothing drifts between worlds by accident. world_move is
// the one deliberate way across: the container keeps its id, its pieces follow
// it out of the source world, and the move is journaled in both worlds as a
// pair that world_undo reverts together.

const MAX_MOVE_PIECES = 500;

type MoveState = {
  // Both journal entries of one move (and of its undo) share this key.
  pair: string;
  kind: "shelf" | "moodboard";
  world: Id<"folders"> | null;
  shelf?: ShelfState;
  board?: MoodboardSnapshot;
  assets: FileState[];
};

const worldRef = (folder: Folder | null) =>
  folder ? { id: folder._id, key: folder.worldKey ?? "", name: folder.name } : { id: null, key: "", name: "no world" };

const moveResult = v.object({
  dryRun: v.boolean(),
  kind: v.union(v.literal("shelf"), v.literal("storybook"), v.literal("moodboard")),
  id: v.string(), name: v.string(),
  from: v.object({ id: v.union(v.null(), v.id("folders")), key: v.string(), name: v.string() }),
  to: v.object({ id: v.id("folders"), key: v.string(), name: v.string() }),
  into: v.string(),
  // Pieces whose memberships change: shelf members, or board items moved along.
  piecesMoved: v.number(),
  // Shelf members already only in the shelf (or in the target world): nothing to refile.
  piecesUnchanged: v.number(),
  // Pieces that also sat on other shelves of the source world (or another world) and left them.
  leftOtherShelves: v.array(v.object({ assetId: v.id("assets"), shelves: v.array(v.string()) })),
  // Moodboards filed in a moved shelf travel with it.
  boards: v.array(v.object({ id: v.id("moodboards"), name: v.string() })),
  // Stories filed in the shelf keep their folderId and follow it.
  stories: v.array(v.object({ id: v.id("stories"), title: v.string() })),
  // Stories whose collection and storybook now sit in different worlds: repoint with update_story.
  storiesToRepoint: v.array(v.object({ id: v.id("stories"), title: v.string(), reason: v.string() })),
  // Moodboard moves: items kept as they are, and source-world items left behind (items: drop).
  itemsKept: v.number(),
  itemsLeftBehind: v.array(v.object({ assetId: v.id("assets"), worlds: v.array(v.string()) })),
  // A dry run that the real move would refuse says why.
  blocked: v.optional(v.string()),
  changeIds: v.array(v.id("worldChanges")),
});

const folderLabel = (folder: Folder | null | undefined, id: Id<"folders">) => folder?.name ?? id;

/**
 * Plan the refiling of `assetIds` so each leaves every world except `target`,
 * keeping `keep` (the moved shelf) and adding `addTo`. Names the shelves left.
 */
const planLeaveWorlds = async (
  ctx: MutationCtx, owner: string, assetIds: Iterable<Id<"assets">>, target: Id<"folders">,
  keep: Id<"folders"> | null, addTo: Id<"folders"> | null, memo: WorldMemo,
) => {
  const befores: FileState[] = [];
  const afters: FileState[] = [];
  const left: { assetId: Id<"assets">; shelves: string[] }[] = [];
  let unchanged = 0;
  for (const assetId of assetIds) {
    const asset = await ctx.db.get(assetId);
    if (!owned(owner, asset)) continue;
    const before = await stateOf(ctx, asset);
    const kept: Id<"folders">[] = [];
    const dropped: string[] = [];
    for (const id of before.folderIds) {
      const world = id === keep ? null : await worldRootOfFolder(ctx, id, memo);
      if (id === keep || !world || world._id === target) kept.push(id);
      else dropped.push(folderLabel(await ctx.db.get(id), id));
    }
    const folderIds = [...new Set(addTo ? [...kept, addTo] : kept)];
    const primary = before.primary && folderIds.includes(before.primary) ? before.primary : keep ?? addTo ?? folderIds[0] ?? null;
    const after: FileState = { assetId, folderIds, primary, tagIds: before.tagIds };
    if (dropped.length > 0) left.push({ assetId, shelves: dropped });
    if (setsEqual(before.folderIds, folderIds) && before.primary === primary) { unchanged += 1; continue; }
    befores.push(before);
    afters.push(after);
  }
  return { befores, afters, left, unchanged };
};

/** Apply file states, recount and resync public counts. */
const applyFileStates = async (ctx: MutationCtx, states: FileState[]) => {
  const touched = new Set<Id<"folders">>();
  for (const state of states) {
    const asset = await ctx.db.get(state.assetId);
    if (!asset) continue;
    for (const id of await applyFileState(ctx, asset, state)) touched.add(id);
  }
  for (const state of states) await syncPublicCollectionMembership(ctx, state.assetId);
  return touched;
};

/** Journal one move in the source world (if any) and the target world, as a pair. */
const journalMove = async (
  ctx: MutationCtx, owner: string, source: Folder | null, target: Folder, targetId: string, targetType: string,
  summary: string, before: MoveState, after: MoveState, journal: JournalMeta, revertOf?: Map<Id<"folders">, Id<"worldChanges">>,
) => {
  const ids: Id<"worldChanges">[] = [];
  for (const world of [source, target]) {
    if (!world) continue;
    ids.push(await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: world._id, op: "world.move", targetType, targetId, summary,
      before, after, revertOf: revertOf?.get(world._id), ...journal,
    }));
  }
  return ids;
};

/** Stories that point at a moved shelf and would now span two worlds. */
const storiesAround = async (ctx: MutationCtx, owner: string, folder: Folder, source: Folder | null, target: Folder) => {
  const filed: Doc<"stories">[] = [];
  const pointing: Doc<"stories">[] = [];
  const sourceFolders = source ? [source, ...(await childrenOf(ctx, source._id))] : [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    filed.push(...await ctx.db.query("stories").withIndex("by_owner_folder_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("folderId", folder._id)).take(500));
    for (const other of sourceFolders) {
      if (other._id === folder._id) continue;
      const rows = await ctx.db.query("stories").withIndex("by_owner_folder_updatedAt", (q) => q.eq("ownerUserId", candidate).eq("folderId", other._id)).take(500);
      pointing.push(...rows.filter((story) => story.storybookId === folder._id));
    }
  }
  const toRepoint = [];
  for (const story of pointing) {
    toRepoint.push({ id: story._id, title: story.title, reason: `filed in "${sourceFolders.find((f) => f._id === story.folderId)?.name}" of ${source?.name}, storybook now in ${target.name}: set folderId to a collection of ${target.name}` });
  }
  for (const story of filed) {
    if (!story.storybookId || story.storybookId === folder._id) continue;
    const bookWorld = await worldIdOfFolder(ctx, story.storybookId);
    if (bookWorld && bookWorld !== target._id) toRepoint.push({ id: story._id, title: story.title, reason: `its storybook stays in another world: clear or change storybookId` });
  }
  return { stories: filed.map((story) => ({ id: story._id, title: story.title })), storiesToRepoint: toRepoint };
};

const moveShelf = async (
  ctx: MutationCtx, owner: string, ref: string, target: Folder, args: { name?: string; dryRun: boolean; note?: string }, journal: JournalMeta,
) => {
  const id = ctx.db.normalizeId("folders", ref.trim().replace(/^(folder|collection|shelf|storybook):/, ""));
  const folder = id ? await ctx.db.get(id) : null;
  if (!owned(owner, folder)) throw new ConvexError(`No collection matches "${ref}". Give the shelf's or storybook's id (open_world lists them).`);
  if (folder.worldKey) throw new ConvexError(`"${folder.name}" is a world root. Worlds never move; move its shelves, storybooks or moodboards instead.`);
  const source = await worldRootOfFolder(ctx, folder._id);
  if (!source || !folder.parentFolderId) {
    throw new ConvexError(`"${folder.name}" is not in a world. Bring a root collection into a world with world_shelf (shelf: its id).`);
  }
  if (source._id === target._id) throw new ConvexError(`"${folder.name}" is already in ${target.name}. Use world_shelf to change it there.`);
  const name = args.name === undefined ? folder.name : normalizeFolderName(args.name);
  if (!name) throw new ConvexError("A shelf needs a name.");
  const normalizedName = scopedName(name, target._id);
  let blocked: string | undefined;
  try {
    await assertNameFree(ctx, owner, normalizedName, folder._id);
  } catch (error) {
    blocked = `${target.name} already has a collection named "${name}": pass name to move it under another name.`;
    if (!args.dryRun) throw error instanceof ConvexError ? new ConvexError(blocked) : error;
  }

  // Every member, by link row or by the legacy primary pointer.
  const memberIds = new Set<Id<"assets">>();
  const links = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", folder._id)).take(MAX_MOVE_PIECES + 1);
  for (const link of links) memberIds.add(link.assetId);
  const primaries = await ctx.db.query("assets").withIndex("by_folder_createdAt", (q) => q.eq("folderId", folder._id)).take(MAX_MOVE_PIECES + 1);
  for (const asset of primaries) memberIds.add(asset._id);
  if (memberIds.size > MAX_MOVE_PIECES) throw new ConvexError(`"${folder.name}" holds more than ${MAX_MOVE_PIECES} pieces; world_move takes at most ${MAX_MOVE_PIECES}.`);

  const memo: WorldMemo = new Map();
  const plan = await planLeaveWorlds(ctx, owner, memberIds, target._id, folder._id, null, memo);

  // Moodboards filed in the shelf travel with it; their other items must not
  // stay behind in another world.
  const boards: Doc<"moodboards">[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    boards.push(...await ctx.db.query("moodboards").withIndex("by_owner_folder_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("folderId", folder._id)).collect());
  }
  for (const board of boards) {
    const strays: string[] = [];
    for (const item of await ctx.db.query("moodboardItems").withIndex("by_moodboard_position", (q) => q.eq("moodboardId", board._id)).collect()) {
      if (memberIds.has(item.assetId)) continue;
      const asset = await ctx.db.get(item.assetId);
      if (!asset) continue;
      for (const folderId of await assetFolderIds(ctx, asset)) {
        const world = await worldRootOfFolder(ctx, folderId, memo);
        if (world && world._id !== target._id) { strays.push(`asset:${asset._id}`); break; }
      }
    }
    if (strays.length > 0 && !blocked) {
      blocked = `Moodboard "${board.name}" on this shelf holds ${strays.length} piece(s) of another world that are not on the shelf (${strays.slice(0, 5).join(", ")}). Put them on the shelf, or file the board in another collection of ${source.name} first (save_moodboard folderId).`;
    }
  }
  if (blocked && !args.dryRun) throw new ConvexError(blocked);
  const around = await storiesAround(ctx, owner, folder, source, target);

  const kind = folder.kind === "storybook" ? "storybook" as const : "shelf" as const;
  const base = {
    kind, id: folder._id as string, name, from: worldRef(source), to: { id: target._id, key: target.worldKey!, name: target.name }, into: target.name,
    piecesMoved: plan.afters.length, piecesUnchanged: plan.unchanged, leftOtherShelves: plan.left,
    boards: boards.map((board) => ({ id: board._id, name: board.name })), ...around,
    itemsKept: 0, itemsLeftBehind: [], blocked,
  };
  if (args.dryRun) return { dryRun: true, ...base, changeIds: [] };

  const pair = `${folder._id}@${Date.now()}`;
  const beforeShelf = shelfState(folder);
  await ctx.db.patch(folder._id, { name, normalizedName, parentFolderId: target._id, updatedAt: Date.now() });
  const afterShelf = shelfState((await ctx.db.get(folder._id))!);
  const touched = await applyFileStates(ctx, plan.afters);
  await recountFolderMembers(ctx, touched);
  const note = args.note?.trim().slice(0, 160);
  const summary = `Moved ${kind} "${folder.name}" from ${source.name} to ${target.name}${name !== folder.name ? ` as "${name}"` : ""} with ${memberIds.size} piece${memberIds.size === 1 ? "" : "s"}${plan.left.length ? ` (${plan.left.length} left other ${source.name} shelves)` : ""}${note ? ` (${note})` : ""}`;
  const changeIds = await journalMove(ctx, owner, source, target, folder._id, kind, summary,
    { pair, kind: "shelf", world: source._id, shelf: beforeShelf, assets: plan.befores },
    { pair, kind: "shelf", world: target._id, shelf: afterShelf, assets: plan.afters }, journal);
  return { dryRun: false, ...base, changeIds };
};

const moveBoard = async (
  ctx: MutationCtx, owner: string, boardId: Id<"moodboards">, target: Folder,
  args: { into?: string; items?: "move" | "drop"; dryRun: boolean; note?: string }, journal: JournalMeta,
) => {
  const board = await ctx.db.get(boardId);
  if (!owned(owner, board)) throw new ConvexError("Moodboard not found.");
  const source = await worldRootOfFolder(ctx, board.folderId);
  if (source?._id === target._id) throw new ConvexError(`"${board.name}" is already in ${target.name}. Use save_moodboard folderId to move it between its collections.`);
  const children = (await childrenOf(ctx, target._id)).filter((child) => owned(owner, child));
  const into = resolveShelf(target, children, args.into ?? "root");
  if (into.kind !== undefined) throw new ConvexError("A moodboard belongs to a plain collection, not a storybook.");
  let blocked: string | undefined;
  for (const candidate of resolveUserIdCandidates(owner)) {
    const clash = await ctx.db.query("moodboards")
      .withIndex("by_owner_folder_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("folderId", into._id).eq("normalizedName", board.normalizedName))
      .first();
    if (clash) blocked = `"${into.name}" already has a moodboard named "${clash.name}". Rename one first (save_moodboard).`;
  }

  // Items in no world or in the target world stay. Pieces of another world
  // either move with the board (items: move) or stay behind (items: drop).
  const items = await ctx.db.query("moodboardItems").withIndex("by_moodboard_position", (q) => q.eq("moodboardId", board._id)).collect();
  const memo: WorldMemo = new Map();
  const foreign: { assetId: Id<"assets">; worlds: string[] }[] = [];
  for (const item of items) {
    const asset = await ctx.db.get(item.assetId);
    if (!asset) continue;
    const worlds = new Map<Id<"folders">, string>();
    for (const folderId of await assetFolderIds(ctx, asset)) {
      const world = await worldRootOfFolder(ctx, folderId, memo);
      if (world && world._id !== target._id) worlds.set(world._id, world.worldKey ?? world.name);
    }
    if (worlds.size > 0) foreign.push({ assetId: asset._id, worlds: [...worlds.values()] });
  }
  if (foreign.length > 0 && !args.items && !blocked) {
    blocked = `${foreign.length} of its items belong to another world (${foreign.slice(0, 5).map((row) => `asset:${row.assetId}`).join(", ")}). Choose items: "move" to move them into ${target.name} with the board, or "drop" to leave them behind and take them off the board.`;
  }
  if (blocked && !args.dryRun) throw new ConvexError(blocked);
  const moving = args.items === "move" ? foreign.map((row) => row.assetId) : [];
  const dropping = args.items === "drop" ? foreign : [];
  const plan = await planLeaveWorlds(ctx, owner, moving, target._id, null, into._id, memo);
  const base = {
    kind: "moodboard" as const, id: board._id as string, name: board.name, from: worldRef(source),
    to: { id: target._id, key: target.worldKey!, name: target.name }, into: into.name,
    piecesMoved: plan.afters.length, piecesUnchanged: plan.unchanged, leftOtherShelves: plan.left, boards: [], stories: [], storiesToRepoint: [],
    itemsKept: items.length - dropping.length, itemsLeftBehind: dropping, blocked,
  };
  if (args.dryRun) return { dryRun: true, ...base, changeIds: [] };

  const pair = `${board._id}@${Date.now()}`;
  const beforeBoard = await snapshotMoodboard(ctx, board);
  const drop = new Set(dropping.map((row) => row.assetId));
  for (const item of items) if (drop.has(item.assetId)) await ctx.db.delete(item._id);
  const remaining = items.filter((item) => !drop.has(item.assetId));
  const coverAssetId = board.coverAssetId && !drop.has(board.coverAssetId) ? board.coverAssetId : remaining[0]?.assetId;
  // The Midjourney code, link and sync record stay as they are.
  await ctx.db.patch(board._id, { folderId: into._id, itemCount: remaining.length, coverAssetId, revision: board.revision + 1, updatedAt: Date.now() });
  const afterBoard = await snapshotMoodboard(ctx, (await ctx.db.get(board._id))!);
  const touched = await applyFileStates(ctx, plan.afters);
  await recountFolderMembers(ctx, touched);
  const note = args.note?.trim().slice(0, 160);
  const summary = `Moved moodboard "${board.name}" from ${source?.name ?? "no world"} to ${target.name} › ${into.name}`
    + `${plan.afters.length ? `; moved ${plan.afters.length} item${plan.afters.length === 1 ? "" : "s"} along` : ""}`
    + `${dropping.length ? `; left ${dropping.length} item${dropping.length === 1 ? "" : "s"} behind` : ""}${note ? ` (${note})` : ""}`;
  const changeIds = await journalMove(ctx, owner, source, target, board._id, "moodboard", summary,
    { pair, kind: "moodboard", world: source?._id ?? null, board: beforeBoard, assets: plan.befores },
    { pair, kind: "moodboard", world: target._id, board: afterBoard, assets: plan.afters }, journal);
  return { dryRun: false, ...base, changeIds };
};

export const moveToWorld = ownerMutation({
  args: {
    ownerUserId: v.string(),
    // The target world: key, name or root id.
    world: v.string(),
    // One of: a shelf or storybook (collection id), or a moodboard.
    shelf: v.optional(v.string()),
    moodboard: v.optional(v.id("moodboards")),
    // Shelf: a new name when the target world already has one by that name.
    name: v.optional(v.string()),
    // Moodboard: the plain collection of the target world it goes into (default the root).
    into: v.optional(v.string()),
    // Moodboard: what happens to items that belong to another world.
    items: v.optional(v.union(v.literal("move"), v.literal("drop"))),
    dryRun: v.optional(v.boolean()),
    note: v.optional(v.string()),
    ...journalArgs,
  },
  returns: moveResult,
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    if (Boolean(args.shelf) === Boolean(args.moodboard)) throw new ConvexError("Give shelf (a shelf or storybook id) or moodboard, one of them.");
    const target = await resolveWorld(ctx, owner, args.world);
    const dryRun = args.dryRun ?? false;
    if (args.shelf) {
      if (args.into || args.items) throw new ConvexError("into and items are for moodboards. A shelf or storybook always goes under the world root (collections are one level deep).");
      return moveShelf(ctx, owner, args.shelf, target, { name: args.name, dryRun, note: args.note }, meta(args));
    }
    if (args.name) throw new ConvexError("Rename a moodboard with save_moodboard, before or after the move.");
    return moveBoard(ctx, owner, args.moodboard!, target, { into: args.into, items: args.items, dryRun, note: args.note }, meta(args));
  },
});

/** Undo one world move: check nothing changed since, put the container and its pieces back. */
const revertMove = async (ctx: MutationCtx, owner: string, before: MoveState, after: MoveState, touched: Set<Id<"folders">>): Promise<RevertOutcome> => {
  const conflicts: string[] = [];
  for (const state of after.assets) {
    const asset = await ctx.db.get(state.assetId);
    if (!asset) { conflicts.push(`asset:${state.assetId} is gone`); continue; }
    const now = await stateOf(ctx, asset);
    if (!setsEqual(now.folderIds, state.folderIds)) conflicts.push(`asset:${state.assetId} was refiled since`);
  }
  if (after.kind === "shelf") {
    const folder = await ctx.db.get(after.shelf!.folderId);
    if (!folder) return { ok: false, reason: "the shelf is gone" };
    if (folder.parentFolderId !== after.shelf!.parentFolderId || folder.name !== after.shelf!.name) conflicts.unshift(`"${folder.name}" moved or was renamed since`);
    if (conflicts.length > 0) return { ok: false, reason: conflicts.slice(0, 5).join("; ") };
    const shelf = before.shelf!;
    if (shelf.normalizedName && shelf.normalizedName !== folder.normalizedName) {
      try { await assertNameFree(ctx, owner, shelf.normalizedName, folder._id); } catch { return { ok: false, reason: `a collection named "${shelf.name}" took its place` }; }
    }
    await ctx.db.patch(folder._id, { name: shelf.name, normalizedName: shelf.normalizedName, parentFolderId: shelf.parentFolderId, updatedAt: Date.now() });
    for (const id of await applyFileStates(ctx, before.assets)) touched.add(id);
    // Pieces filed into the target world since would end up in two worlds.
    const home = await ctx.db.get(shelf.parentFolderId!);
    try {
      await assertMembersFitWorld(ctx, folder._id, before.world, `"${folder.name}" cannot go back to ${home?.name ?? "its world"}`);
    } catch (error) {
      return { ok: false, reason: error instanceof ConvexError ? String(error.data) : "its pieces changed since" };
    }
    return { ok: true, summary: "" };
  } else {
    if (conflicts.length > 0) return { ok: false, reason: conflicts.slice(0, 5).join("; ") };
    const outcome = await restoreMoodboardSnapshot(ctx, owner, after.board!.moodboardId, before.board!, after.board!, false);
    if (!outcome.ok) return outcome;
  }
  for (const id of await applyFileStates(ctx, before.assets)) touched.add(id);
  return { ok: true, summary: "" };
};

/* ── Journal ─────────────────────────────────────────────────────────────── */

const recentChanges =async (ctx: QueryCtx, owner: string, worldId: Id<"folders">, limit: number, before?: number) => {
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

/**
 * Revert one change if its target still holds the change's result (compared
 * by content, so an earlier undo in the same run does not count as a change).
 * Folders whose membership moved go into `touched` for one recount at the end.
 */
const revertChange = async (ctx: MutationCtx, owner: string, change: Change, journal: JournalMeta, touched: Set<Id<"folders">>): Promise<RevertOutcome> => {
  if (change.revertedBy) return { ok: false, reason: "already undone" };
  const root = await ctx.db.get(change.worldFolderId);
  if (!root) return { ok: false, reason: "its world no longer exists" };
  const record = async (summary: string, before: unknown, after: unknown, op: WorldChangeOp = change.op as WorldChangeOp, targetId = change.targetId) => {
    const undoId = await recordWorldChange(ctx, {
      ownerUserId: owner, worldFolderId: root._id, op, targetType: change.targetType, targetId,
      summary: `Undo: ${summary}`, before, after, revertOf: change._id, ...journal,
      // Without its own label an undo joins the session it reverts.
      session: journal.session ?? change.session,
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
      if ((current?.body ?? null) !== after.body) {
        return { ok: false, reason: `${after.path} changed since (now revision ${current?.revision ?? 0}); undo the later change first` };
      }
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
      for (const [index, asset] of assets.entries()) {
        const target = before.find((state) => state.assetId === asset._id) ?? before[index]!;
        for (const id of await applyFileState(ctx, asset, target)) touched.add(id);
      }
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
      const outcome = await restoreMoodboardSnapshot(ctx, owner, change.targetId as Id<"moodboards">, before, after, false);
      if (!outcome.ok) return outcome;
      // A deleted board comes back under a new id; the undo entry names it.
      await record(change.summary, after, outcome.restored, change.op as WorldChangeOp, outcome.restored?.moodboardId ?? change.targetId);
      return { ok: true, summary: change.summary };
    }
    case "profile.save": {
      const before = parse<ProfileSnapshot>(change.before);
      const after = parse<ProfileSnapshot>(change.after);
      const outcome = await restoreProfileSnapshot(ctx, owner, change.targetId as Id<"mjProfiles">, before, after, false);
      if (!outcome.ok) return outcome;
      await record(change.summary, after, outcome.restored);
      return { ok: true, summary: change.summary };
    }
    case "world.move": {
      const before = parse<MoveState>(change.before)!;
      const after = parse<MoveState>(change.after)!;
      // The same move is journaled in the other world too; both revert together.
      const sibling = (await ctx.db.query("worldChanges")
        .withIndex("by_owner_target_createdAt", (q) => q.eq("ownerUserId", change.ownerUserId).eq("targetId", change.targetId))
        .order("desc").take(200))
        .find((row) => row._id !== change._id && row.op === "world.move" && !row.revertedBy && parse<MoveState>(row.after)?.pair === after.pair) ?? null;
      const outcome = await revertMove(ctx, owner, before, after, touched);
      if (!outcome.ok) return outcome;
      const pair = `undo:${change._id}`;
      const undoBefore: MoveState = { ...after, pair };
      const undoAfter: MoveState = { ...before, pair };
      await record(change.summary, undoBefore, undoAfter);
      if (sibling) {
        const undoId = await recordWorldChange(ctx, {
          ownerUserId: owner, worldFolderId: sibling.worldFolderId, op: "world.move", targetType: sibling.targetType, targetId: sibling.targetId,
          summary: `Undo: ${change.summary}`, before: undoBefore, after: undoAfter, revertOf: sibling._id, ...journal,
          session: journal.session ?? change.session,
        });
        await ctx.db.patch(sibling._id, { revertedBy: undoId });
      }
      return { ok: true, summary: change.summary };
    }
    case "world.recount": {
      // Counts are derived from the membership rows, so there is nothing to
      // put back: undo re-derives memberCount for the collections it named
      // (the public count stays exact) and lets a session undo go on past it.
      const after = parse<{ folderId: Id<"folders"> }[]>(change.after) ?? [];
      for (const row of after) touched.add(row.folderId);
      await record(change.summary, after, after);
      return { ok: true, summary: change.summary };
    }
    case "story.save": {
      const before = parse<StorySnapshot>(change.before);
      const after = parse<StorySnapshot>(change.after)!;
      const outcome = await restoreStorySnapshot(ctx, owner, change.targetId as Id<"stories">, before, after, false);
      if (!outcome.ok) return outcome;
      await record(change.summary, after, outcome.restored);
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
    const touched = new Set<Id<"folders">>();
    // Newest first. Each revert sees the state the previous one left, so a
    // session that edited one doc twice unwinds both edits. A blocked change
    // stops the run.
    let stoppedAt = changes.length;
    for (const [index, change] of changes.entries()) {
      // A world move is journaled in both worlds; reverting one entry reverts
      // its pair, which may come later in this same run.
      if (!change.revertedBy && (await ctx.db.get(change._id))?.revertedBy) {
        undone.push({ changeId: change._id, summary: change.summary });
        continue;
      }
      const outcome = await revertChange(ctx, owner, change, meta(args), touched);
      if (outcome.ok) undone.push({ changeId: change._id, summary: change.summary });
      else { blocked.push({ changeId: change._id, summary: change.summary, reason: outcome.reason }); stoppedAt = index; break; }
    }
    const skipped = changes.slice(stoppedAt + 1)
      .map((change) => ({ changeId: change._id, summary: change.summary, reason: "an earlier change in this undo was blocked" }));
    const report = { dryRun, undone, blocked: [...blocked, ...skipped] };
    // All or nothing: a blocked run and every dry run end by throwing, so
    // Convex rolls back every revert made above. The report rides on the error.
    if (dryRun || blocked.length > 0) throw new ConvexError({ kind: "world-undo-report", ...report });
    await recountFolderMembers(ctx, touched);
    return report;
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
