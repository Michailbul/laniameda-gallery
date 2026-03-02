import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";

const ingestFailureSourceValidator = v.union(v.literal("api"));
const ingestFailureStatusValidator = v.union(v.literal("pending"), v.literal("resolved"));

const ingestFailureValidator = v.object({
  _id: v.id("ingest_failures"),
  _creationTime: v.number(),
  source: ingestFailureSourceValidator,
  ownerUserId: v.optional(v.string()),
  ingestKey: v.optional(v.string()),
  status: ingestFailureStatusValidator,
  attemptCount: v.number(),
  payload: v.optional(v.any()),
  lastErrorMessage: v.string(),
  lastErrorName: v.optional(v.string()),
  firstErrorAt: v.number(),
  lastErrorAt: v.number(),
  resolvedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

const normalizeOptionalString = (value?: string) => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

export const recordIngestFailure = mutation({
  args: {
    source: ingestFailureSourceValidator,
    ownerUserId: v.optional(v.string()),
    ingestKey: v.optional(v.string()),
    payload: v.optional(v.any()),
    errorMessage: v.string(),
    errorName: v.optional(v.string()),
  },
  returns: v.object({
    failureId: v.id("ingest_failures"),
    status: ingestFailureStatusValidator,
    attemptCount: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    failureId: Id<"ingest_failures">;
    status: "pending" | "resolved";
    attemptCount: number;
  }> => {
    const ownerUserId = normalizeOptionalString(args.ownerUserId);
    const ingestKey = normalizeOptionalString(args.ingestKey);
    const errorMessage = args.errorMessage.trim();

    if (!errorMessage) {
      throw new ConvexError("errorMessage is required.");
    }

    const now = Date.now();

    if (ownerUserId && ingestKey) {
      const existing = await ctx.db
        .query("ingest_failures")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("ingestKey", ingestKey),
        )
        .unique();

      if (existing) {
        const attemptCount = existing.attemptCount + 1;
        await ctx.db.patch(existing._id, {
          source: args.source,
          ownerUserId,
          ingestKey,
          status: "pending",
          attemptCount,
          payload: args.payload,
          lastErrorMessage: errorMessage,
          lastErrorName: normalizeOptionalString(args.errorName),
          lastErrorAt: now,
          resolvedAt: undefined,
          updatedAt: now,
        });

        return {
          failureId: existing._id,
          status: "pending",
          attemptCount,
        };
      }
    }

    const failureId = await ctx.db.insert("ingest_failures", {
      source: args.source,
      ownerUserId,
      ingestKey,
      status: "pending",
      attemptCount: 1,
      payload: args.payload,
      lastErrorMessage: errorMessage,
      lastErrorName: normalizeOptionalString(args.errorName),
      firstErrorAt: now,
      lastErrorAt: now,
      updatedAt: now,
    });

    return {
      failureId,
      status: "pending",
      attemptCount: 1,
    };
  },
});

export const resolveIngestFailure = mutation({
  args: {
    ownerUserId: v.string(),
    ingestKey: v.string(),
  },
  returns: v.object({
    resolved: v.boolean(),
    failureId: v.optional(v.id("ingest_failures")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const ingestKey = args.ingestKey.trim();

    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (!ingestKey) {
      throw new ConvexError("ingestKey is required.");
    }

    const existing = await ctx.db
      .query("ingest_failures")
      .withIndex("by_owner_ingestKey", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("ingestKey", ingestKey),
      )
      .unique();

    if (!existing) {
      return { resolved: false };
    }

    if (existing.status !== "resolved") {
      await ctx.db.patch(existing._id, {
        status: "resolved",
        resolvedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return {
      resolved: true,
      failureId: existing._id,
    };
  },
});

export const listIngestFailures = query({
  args: {
    status: v.optional(ingestFailureStatusValidator),
    ownerUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(ingestFailureValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 200);
    const ownerUserId = normalizeOptionalString(args.ownerUserId);
    const status = args.status;

    if (ownerUserId && status) {
      return await ctx.db
        .query("ingest_failures")
        .withIndex("by_owner_status_lastErrorAt", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("status", status).gte("lastErrorAt", 0),
        )
        .order("desc")
        .take(limit);
    }

    if (status) {
      return await ctx.db
        .query("ingest_failures")
        .withIndex("by_status_lastErrorAt", (q) =>
          q.eq("status", status).gte("lastErrorAt", 0),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("ingest_failures")
      .withIndex("by_status_lastErrorAt", (q) => q.eq("status", "pending").gte("lastErrorAt", 0))
      .order("desc")
      .take(limit);
  },
});
