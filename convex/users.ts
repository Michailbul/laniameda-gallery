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
  onboardingCompletedAt: v.optional(v.number()),
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

export const getUser = query({
  args: { id: v.id("users") },
  returns: v.union(v.null(), userReturnValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const markOnboardingCompleted = mutation({
  args: { userId: v.id("users") },
  returns: userReturnValidator,
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError("User not found.");
    }
    const now = Date.now();
    if (user.onboardingCompletedAt) {
      return user;
    }
    await ctx.db.patch(user._id, {
      onboardingCompletedAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get(user._id))!;
  },
});

export const normalizeOwnership = mutation({
  args: {
    targetOwnerUserId: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    targetOwnerUserId: v.string(),
    dryRun: v.boolean(),
    assetsUpdated: v.number(),
    promptsUpdated: v.number(),
    usersUpdated: v.number(),
    runsUpdated: v.number(),
  }),
  handler: async (ctx, args) => {
    const targetOwnerUserId = args.targetOwnerUserId.trim();
    if (!targetOwnerUserId) {
      throw new ConvexError("targetOwnerUserId is required.");
    }

    const dryRun = args.dryRun ?? false;

    const assets = await ctx.db.query("assets").collect();
    const prompts = await ctx.db.query("prompts").collect();
    const users = await ctx.db.query("users").collect();
    const runs = await ctx.db.query("runs").collect();

    let assetsUpdated = 0;
    for (const asset of assets) {
      if (asset.ownerUserId === targetOwnerUserId) continue;
      assetsUpdated += 1;
      if (!dryRun) {
        await ctx.db.patch(asset._id, { ownerUserId: targetOwnerUserId });
      }
    }

    let promptsUpdated = 0;
    for (const prompt of prompts) {
      if (prompt.ownerUserId === targetOwnerUserId) continue;
      promptsUpdated += 1;
      if (!dryRun) {
        await ctx.db.patch(prompt._id, { ownerUserId: targetOwnerUserId });
      }
    }

    let usersUpdated = 0;
    for (const user of users) {
      if (user.ownerUserId === targetOwnerUserId) continue;
      usersUpdated += 1;
      if (!dryRun) {
        await ctx.db.patch(user._id, { ownerUserId: targetOwnerUserId, updatedAt: Date.now() });
      }
    }

    let runsUpdated = 0;
    for (const run of runs) {
      if (run.userId === targetOwnerUserId) continue;
      runsUpdated += 1;
      if (!dryRun) {
        await ctx.db.patch(run._id, { userId: targetOwnerUserId, updatedAt: Date.now() });
      }
    }

    return {
      targetOwnerUserId,
      dryRun,
      assetsUpdated,
      promptsUpdated,
      usersUpdated,
      runsUpdated,
    };
  },
});
