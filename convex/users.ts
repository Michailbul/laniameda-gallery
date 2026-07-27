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

