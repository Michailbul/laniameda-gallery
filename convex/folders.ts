import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const createFolder = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  returns: v.id("folders"),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Folder name is required.");
    }
    const existing = await ctx.db
      .query("folders")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("folders", {
      name,
      description: args.description?.trim() || undefined,
    });
  },
});

export const listFolders = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("folders"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db
      .query("folders")
      .withIndex("by_name", (q) => q.gte("name", ""))
      .collect();
  },
});
