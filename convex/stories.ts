import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { storyFields, storyKindValidator, storyResultValidator, storyStatusValidator } from "./storyValidators";

const ownedStory = async (ctx: QueryCtx, owner: string, id: Id<"stories">) => {
  const story = await ctx.db.get(id);
  if (!story || !canActorAccessOwnerUserId(owner, story.ownerUserId)) throw new ConvexError("Story not found.");
  return story;
};

const requireReferences = async (ctx: QueryCtx, owner: string, data: {
  folderId?: Id<"folders">; storybookId?: Id<"folders">; assetIds: Id<"assets">[];
}) => {
  for (const id of [data.folderId, data.storybookId]) {
    if (!id) continue;
    const folder = await ctx.db.get(id);
    if (!folder || !canActorAccessOwnerUserId(owner, folder.ownerUserId)) throw new ConvexError("Collection not found.");
    if (id === data.storybookId && folder.kind !== "storybook") throw new ConvexError("storybookId must refer to a storybook.");
  }
  if (data.assetIds.length > 120) throw new ConvexError("A story can reference at most 120 assets.");
  for (const id of data.assetIds) {
    const asset = await ctx.db.get(id);
    if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) throw new ConvexError("Source asset not found.");
  }
};

const words = (value: string | undefined) => value?.trim() || undefined;
const normalize = (data: Omit<Doc<"stories">, "_id" | "_creationTime" | "ownerUserId" | "ingestKey" | "revision" | "searchText" | "createdAt" | "updatedAt">) => {
  const title = data.title.trim();
  const body = data.body.trim();
  if (!title || !body) throw new ConvexError("Title and text are required.");
  if (title.length > 200 || body.length > 200_000) throw new ConvexError("Title is limited to 200 characters and text to 200,000 characters.");
  const tagNames = [...new Set(data.tagNames.map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
  const normalized = { ...data, title, body, folderId: data.folderId, storybookId: data.storybookId, logline: words(data.logline), hook: words(data.hook), styleTag: words(data.styleTag), tagNames, assetIds: [...new Set(data.assetIds)] };
  return { ...normalized, searchText: [title, body, normalized.logline, normalized.hook, normalized.styleTag, ...tagNames].filter(Boolean).join("\n").toLowerCase() };
};

export const listStories = ownerQuery({
  args: { ownerUserId: v.string(), folderId: v.optional(v.id("folders")), kind: v.optional(storyKindValidator), status: v.optional(storyStatusValidator), search: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(storyResultValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 200)));
    const rows: Doc<"stories">[] = [];
    const folderIds: (Id<"folders"> | undefined)[] = [args.folderId];
    if (args.folderId) {
      const children = await ctx.db.query("folders").withIndex("by_parent", (q) => q.eq("parentFolderId", args.folderId)).collect();
      folderIds.push(...children.filter((folder) => canActorAccessOwnerUserId(args.ownerUserId, folder.ownerUserId)).map((folder) => folder._id));
    }
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      for (const folderId of args.search?.trim() ? [undefined] : folderIds) {
      const query = args.search?.trim()
        ? ctx.db.query("stories").withSearchIndex("search_text", (q) => q.search("searchText", args.search!.trim()).eq("ownerUserId", owner))
        : folderId
          ? ctx.db.query("stories").withIndex("by_owner_folder_updatedAt", (q) => q.eq("ownerUserId", owner).eq("folderId", folderId)).order("desc")
          : ctx.db.query("stories").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", owner)).order("desc");
      // Facet predicates apply before the result limit, never after a partial page.
      let filtered = query;
      if (args.folderId && args.search?.trim()) filtered = filtered.filter((q) => q.or(...folderIds.filter((id) => id !== undefined).map((id) => q.eq(q.field("folderId"), id))));
      if (args.kind) filtered = filtered.filter((q) => q.eq(q.field("kind"), args.kind));
      if (args.status) filtered = filtered.filter((q) => q.eq(q.field("status"), args.status));
      rows.push(...await filtered.take(limit));
      }
    }
    const unique = [...new Map(rows.map((row) => [row._id, row])).values()];
    return (args.search?.trim() ? unique : unique.sort((a, b) => b.updatedAt - a.updatedAt)).slice(0, limit);
  },
});

export const getStory = ownerQuery({
  args: { ownerUserId: v.string(), id: v.id("stories") }, returns: storyResultValidator,
  handler: (ctx, args) => ownedStory(ctx, args.ownerUserId, args.id),
});

export const getStoryLinkStatus = ownerQuery({
  args: { ownerUserId: v.string(), id: v.id("stories") },
  returns: v.object({ missingAssetIds: v.array(v.id("assets")), missingFolder: v.boolean(), missingStorybook: v.boolean() }),
  handler: async (ctx, args) => {
    const story = await ownedStory(ctx, args.ownerUserId, args.id);
    const missingAssetIds: Id<"assets">[] = [];
    for (const id of story.assetIds) {
      const asset = await ctx.db.get(id);
      if (!asset || !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) missingAssetIds.push(id);
    }
    const folder = story.folderId ? await ctx.db.get(story.folderId) : null;
    const book = story.storybookId ? await ctx.db.get(story.storybookId) : null;
    return { missingAssetIds, missingFolder: Boolean(story.folderId && (!folder || !canActorAccessOwnerUserId(args.ownerUserId, folder.ownerUserId))), missingStorybook: Boolean(story.storybookId && (!book || book.kind !== "storybook" || !canActorAccessOwnerUserId(args.ownerUserId, book.ownerUserId))) };
  },
});

export const saveStory = ownerMutation({
  args: { ownerUserId: v.string(), ingestKey: v.string(), ...storyFields, expectedRevision: v.optional(v.number()) },
  returns: v.object({ id: v.id("stories"), created: v.boolean(), revision: v.number() }),
  handler: async (ctx, args) => {
    const ingestKey = args.ingestKey.trim();
    if (!ingestKey || ingestKey.length > 300) throw new ConvexError("A stable ingestKey is required (at most 300 characters).");
    const { ownerUserId, expectedRevision, ingestKey: _key, ...input } = args;
    void _key;
    const data = normalize(input);
    await requireReferences(ctx, ownerUserId, data);
    let existing: Doc<"stories"> | null = null;
    for (const owner of resolveUserIdCandidates(ownerUserId)) {
      existing = await ctx.db.query("stories").withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", owner).eq("ingestKey", ingestKey)).unique();
      if (existing) break;
    }
    const now = Date.now();
    if (!existing) {
      if (expectedRevision !== undefined && expectedRevision !== 0) throw new ConvexError("Story changed. Reload before saving.");
      const id = await ctx.db.insert("stories", { ownerUserId, ingestKey, ...data, revision: 1, createdAt: now, updatedAt: now });
      return { id, created: true, revision: 1 };
    }
    // An exact retry is harmless even if its revision is now stale.
    const keys = Object.keys(data) as (keyof typeof data)[];
    if (keys.every((key) => JSON.stringify(existing![key]) === JSON.stringify(data[key]))) return { id: existing._id, created: false, revision: existing.revision };
    if (expectedRevision !== undefined && expectedRevision !== existing.revision) throw new ConvexError("Story changed. Reload before saving.");
    const { _id, _creationTime, ingestKey: _oldKey, searchText: _search, createdAt: _created, updatedAt: _updated, ...snapshot } = existing;
    void _creationTime; void _oldKey; void _search; void _created; void _updated;
    await ctx.db.insert("storyRevisions", { ...snapshot, storyId: _id, savedAt: now });
    await ctx.db.patch(_id, { ...data, revision: existing.revision + 1, updatedAt: now });
    return { id: _id, created: false, revision: existing.revision + 1 };
  },
});

export const listStoryRevisions = ownerQuery({
  args: { ownerUserId: v.string(), id: v.id("stories") },
  returns: v.array(v.object({ _id: v.id("storyRevisions"), _creationTime: v.number(), ownerUserId: v.string(), storyId: v.id("stories"), ...storyFields, revision: v.number(), savedAt: v.number() })),
  handler: async (ctx, args) => {
    await ownedStory(ctx, args.ownerUserId, args.id);
    return ctx.db.query("storyRevisions").withIndex("by_story_revision", (q) => q.eq("storyId", args.id)).order("desc").collect();
  },
});

export const deleteStory = ownerMutation({
  args: { ownerUserId: v.string(), id: v.id("stories") }, returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.id);
    if (!record) return null;
    await ownedStory(ctx, args.ownerUserId, args.id);
    const versions = await ctx.db.query("storyRevisions").withIndex("by_story_revision", (q) => q.eq("storyId", args.id)).collect();
    for (const version of versions) await ctx.db.delete(version._id);
    await ctx.db.delete(args.id);
    return null;
  },
});
