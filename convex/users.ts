import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { actorMatchesUserId, requireActor } from "./actor";

// The Next.js server resolves the signed-in Telegram session to a users row
// before it knows the ownerUserId, so it mints a token for the Telegram id.
// Nobody else may look up or create rows for someone else's Telegram id.
const assertActorIsTelegramUser = async (
  ctx: Parameters<typeof requireActor>[0],
  telegramId: string,
) => {
  const actor = await requireActor(ctx);
  if (actor && !actorMatchesUserId(actor, telegramId)) {
    throw new ConvexError("telegramId does not match the signed-in user.");
  }
};

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
    await assertActorIsTelegramUser(ctx, telegramId);
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
    await assertActorIsTelegramUser(ctx, telegramId);

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

