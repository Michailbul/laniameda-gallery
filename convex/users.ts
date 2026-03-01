import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const userReturnValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  telegramId: v.optional(v.string()),
  workosUserId: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  ownerUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const resolveByTelegramId = query({
  args: { telegramId: v.string() },
  returns: v.union(v.null(), userReturnValidator),
  handler: async (ctx, args) => {
    const telegramId = args.telegramId.trim();
    if (!telegramId) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_telegramId", (q) => q.eq("telegramId", telegramId))
      .unique();
  },
});

export const resolveByWorkosUserId = query({
  args: { workosUserId: v.string() },
  returns: v.union(v.null(), userReturnValidator),
  handler: async (ctx, args) => {
    const workosUserId = args.workosUserId.trim();
    if (!workosUserId) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
  },
});

export const resolveOrCreateByTelegram = mutation({
  args: {
    telegramId: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: userReturnValidator,
  handler: async (ctx, args) => {
    const telegramId = args.telegramId.trim();
    if (!telegramId) {
      throw new ConvexError("telegramId is required.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_telegramId", (q) => q.eq("telegramId", telegramId))
      .unique();
    if (existing) {
      const updates: Record<string, string | number> = { updatedAt: Date.now() };
      if (args.name && args.name !== existing.name) updates.name = args.name;
      if (args.avatarUrl && args.avatarUrl !== existing.avatarUrl) updates.avatarUrl = args.avatarUrl;
      if (Object.keys(updates).length > 1) {
        await ctx.db.patch(existing._id, updates);
        return { ...existing, ...updates };
      }
      return existing;
    }

    const now = Date.now();
    const id = await ctx.db.insert("users", {
      telegramId,
      name: args.name,
      avatarUrl: args.avatarUrl,
      ownerUserId: telegramId,
      createdAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get(id))!;
  },
});

export const resolveOrCreateByWorkos = mutation({
  args: {
    workosUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: userReturnValidator,
  handler: async (ctx, args) => {
    const workosUserId = args.workosUserId.trim();
    if (!workosUserId) {
      throw new ConvexError("workosUserId is required.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (existing) {
      const updates: Record<string, string | number> = { updatedAt: Date.now() };
      if (args.email && args.email !== existing.email) updates.email = args.email;
      if (args.name && args.name !== existing.name) updates.name = args.name;
      if (args.avatarUrl && args.avatarUrl !== existing.avatarUrl) updates.avatarUrl = args.avatarUrl;
      if (Object.keys(updates).length > 1) {
        await ctx.db.patch(existing._id, updates);
        return { ...existing, ...updates };
      }
      return existing;
    }

    const now = Date.now();
    const id = await ctx.db.insert("users", {
      workosUserId,
      email: args.email,
      name: args.name,
      avatarUrl: args.avatarUrl,
      ownerUserId: workosUserId,
      createdAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get(id))!;
  },
});

export const linkTelegram = mutation({
  args: {
    userId: v.id("users"),
    telegramId: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  returns: userReturnValidator,
  handler: async (ctx, args) => {
    const telegramId = args.telegramId.trim();
    if (!telegramId) {
      throw new ConvexError("telegramId is required.");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError("User not found.");
    }

    if (user.telegramId && user.telegramId !== telegramId) {
      throw new ConvexError("User already linked to a different Telegram account.");
    }

    const conflict = await ctx.db
      .query("users")
      .withIndex("by_telegramId", (q) => q.eq("telegramId", telegramId))
      .unique();
    if (conflict && conflict._id !== user._id) {
      throw new ConvexError("This Telegram account is already linked to another user.");
    }

    const now = Date.now();
    await ctx.db.patch(user._id, {
      telegramId,
      ownerUserId: telegramId,
      ...(args.name ? { name: args.name } : {}),
      ...(args.avatarUrl ? { avatarUrl: args.avatarUrl } : {}),
      updatedAt: now,
    });

    return (await ctx.db.get(user._id))!;
  },
});

export const linkWorkos = mutation({
  args: {
    userId: v.id("users"),
    workosUserId: v.string(),
    email: v.optional(v.string()),
  },
  returns: userReturnValidator,
  handler: async (ctx, args) => {
    const workosUserId = args.workosUserId.trim();
    if (!workosUserId) {
      throw new ConvexError("workosUserId is required.");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError("User not found.");
    }

    if (user.workosUserId && user.workosUserId !== workosUserId) {
      throw new ConvexError("User already linked to a different WorkOS account.");
    }

    const conflict = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (conflict && conflict._id !== user._id) {
      throw new ConvexError("This WorkOS account is already linked to another user.");
    }

    const now = Date.now();
    await ctx.db.patch(user._id, {
      workosUserId,
      ...(args.email ? { email: args.email } : {}),
      updatedAt: now,
    });

    return (await ctx.db.get(user._id))!;
  },
});

export const getUser = query({
  args: { id: v.id("users") },
  returns: v.union(v.null(), userReturnValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
