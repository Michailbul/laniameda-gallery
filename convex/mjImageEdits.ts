import { ConvexError, v } from "convex/values";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { editFrame, imageEditFields } from "./mjImageEditValidators";
import { fastModelById } from "../lib/mj-fast-helper";
import { buildR2PublicUrl } from "./r2_url";

const DEFAULT_TITLE = "Midjourney edit";
const threadOut = v.object({ _id: v.id("mjImageEditThreads"), _creationTime: v.number(), ...imageEditFields });
const owned = async (ctx: QueryCtx | MutationCtx, owner: string, id: string) => {
  const key = ctx.db.normalizeId("mjImageEditThreads", id);
  const row = key ? await ctx.db.get(key) : null;
  if (!row || !canActorAccessOwnerUserId(owner, row.ownerUserId)) throw new ConvexError("That edit thread is unavailable.");
  return row;
};

export const read = ownerQuery({
  args: { ownerUserId: v.string(), id: v.string() }, returns: threadOut,
  handler: (ctx, args) => owned(ctx, args.ownerUserId, args.id),
});
export const head = ownerQuery({
  args: { ownerUserId: v.string(), id: v.string() }, returns: v.object({ updatedAt: v.number() }),
  handler: async (ctx, args) => ({ updatedAt: (await owned(ctx, args.ownerUserId, args.id)).updatedAt }),
});

export const list = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(v.object({ id: v.id("mjImageEditThreads"), title: v.string(), image: v.string(), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    const pages = await Promise.all(resolveUserIdCandidates(args.ownerUserId).map(owner => ctx.db.query("mjImageEditThreads")
      .withIndex("by_owner_updated", q => q.eq("ownerUserId", owner)).order("desc").take(30)));
    return pages.flat().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
      .map(row => ({ id: row._id, title: row.title, image: row.activeSource.url, updatedAt: row.updatedAt }));
  },
});

// The frame's thread, if it has one: opening a picture creates nothing.
export const find = ownerQuery({
  args: { ownerUserId: v.string(), key: v.string() }, returns: v.union(threadOut, v.null()),
  handler: async (ctx, args) => {
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const row = await ctx.db.query("mjImageEditThreads").withIndex("by_owner_key", q => q.eq("ownerUserId", owner).eq("key", args.key)).unique();
      if (row) return row;
    }
    return null;
  },
});

// Forget a thread (its runs and kept takes stay in the gallery).
export const remove = ownerMutation({
  args: { ownerUserId: v.string(), id: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.ownerUserId, args.id);
    await ctx.db.delete(row._id);
    return null;
  },
});

export const create = ownerMutation({
  args: { ownerUserId: v.string(), key: v.string(), source: editFrame }, returns: threadOut,
  handler: async (ctx, args) => {
    if (!args.key || args.key.length > 160 || args.source.url.length > 2000 || !args.source.url.startsWith("https://")) throw new ConvexError("Invalid image.");
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const old = await ctx.db.query("mjImageEditThreads").withIndex("by_owner_key", q => q.eq("ownerUserId", owner).eq("key", args.key)).unique();
      if (old) return old;
    }
    const now = Date.now();
    const source = { ...args.source, url: (args.source.r2Key ? buildR2PublicUrl(args.source.r2Key) : null) || args.source.url };
    const id = await ctx.db.insert("mjImageEditThreads", { ownerUserId: args.ownerUserId, key: args.key,
      title: (source.prompt || DEFAULT_TITLE).slice(0, 100), source, activeSource: source,
      model: "seedream-5.5", count: 1, draft: "", galleryEnabled: false, messages: [], runIds: [], createdAt: now, updatedAt: now });
    return (await ctx.db.get(id))!;
  },
});

export const update = ownerMutation({
  args: { ownerUserId: v.string(), id: v.string(), draft: v.optional(v.string()), model: v.optional(v.string()), count: v.optional(v.number()),
    galleryEnabled: v.optional(v.boolean()), world: v.optional(v.string()), activeSource: v.optional(editFrame),
    message: v.optional(v.object({ id: v.string(), role: v.union(v.literal("michael"), v.literal("agent")), text: v.string(),
      prompt: v.optional(v.string()), reads: v.optional(v.array(v.string())) })) },
  returns: threadOut,
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.ownerUserId, args.id);
    if (args.message && row.messages.some(m => m.id === args.message!.id)) return row;
    if (args.model && !fastModelById(args.model)) throw new ConvexError("Choose an edit model.");
    if (args.count !== undefined && (!Number.isInteger(args.count) || args.count < 1 || args.count > 3)) throw new ConvexError("Choose 1, 2 or 3 takes.");
    if ((args.draft?.length ?? 0) > 2000 || (args.message?.text.length ?? 0) > 6000) throw new ConvexError("That message is too long.");
    if (args.message && !row.messages.some(m => m.id === args.message!.id) && row.messages.length >= 200) throw new ConvexError("This thread is full. Start another edit to keep its history.");
    if (args.message && JSON.stringify(row.messages).length + JSON.stringify(args.message).length > 400_000) throw new ConvexError("This thread is full. Start another edit to keep its history.");
    if (args.activeSource?.parentRunId) {
      const id = ctx.db.normalizeId("mjQuickRuns", args.activeSource.parentRunId);
      const run = id ? await ctx.db.get(id) : null;
      const take = run?.takes[args.activeSource.parentIndex ?? -1];
      if (!run || !canActorAccessOwnerUserId(args.ownerUserId, run.ownerUserId) || take?.status !== "done") throw new ConvexError("Choose a finished take.");
      const url = (take.r2Key ? buildR2PublicUrl(take.r2Key) : undefined) || take.falUrl;
      if (!url || args.activeSource.url !== url) throw new ConvexError("That picture does not match the selected take.");
    }
    const { ownerUserId: _owner, id: _id, message, ...patch } = args;
    void _owner; void _id;
    const messages = message && !row.messages.some(m => m.id === message.id)
      ? [...row.messages, { ...message, text: message.text.slice(0, 6000), prompt: message.prompt?.slice(0, 2000), reads: message.reads?.slice(0, 24), createdAt: Date.now() }] : row.messages;
    // A thread is named after what it asks for, once it asks for something.
    const named = row.title === DEFAULT_TITLE && patch.draft?.trim() ? { title: patch.draft.trim().replace(/\s+/g, " ").slice(0, 100) } : {};
    await ctx.db.patch(row._id, { ...patch, ...named, messages, updatedAt: Date.now() });
    return (await ctx.db.get(row._id))!;
  },
});
