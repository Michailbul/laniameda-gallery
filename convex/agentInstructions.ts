import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { signedOwnerMutation, signedOwnerQuery } from "./actor";
import { resolveUserIdCandidates } from "./authz";

const resourceFields = {
  resourcePath: v.string(), content: v.string(), version: v.string(),
  sha256: v.string(), createdAt: v.number(), updatedAt: v.number(),
};

const ownedResource = async (ctx: QueryCtx, owner: string, path: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const record = await ctx.db.query("agentInstructions")
      .withIndex("by_owner_path", (q) => q.eq("ownerUserId", candidate).eq("resourcePath", path)).unique();
    if (record) return record;
  }
  return null;
};

export const getResource = signedOwnerQuery({
  args: { ownerUserId: v.string(), resourcePath: v.string() },
  returns: v.union(v.null(), v.object(resourceFields)),
  handler: async (ctx, args) => {
    const record = await ownedResource(ctx, args.ownerUserId, args.resourcePath);
    if (!record) return null;
    const { _id, _creationTime, ownerUserId, ...result } = record;
    void _id; void _creationTime; void ownerUserId;
    return result;
  },
});

export const saveResource = signedOwnerMutation({
  args: { ownerUserId: v.string(), resourcePath: v.string(), content: v.string(), version: v.string(), expectedSha256: v.optional(v.string()) },
  returns: v.object({ sha256: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    if (!/^references\/[a-z0-9-]+\.md$/.test(args.resourcePath)) throw new ConvexError("Invalid instruction resource path.");
    if (!args.content.trim() || args.content.length > 200_000) throw new ConvexError("Instruction content must contain 1 to 200,000 characters.");
    if (!args.version.trim() || args.version.length > 40) throw new ConvexError("Instruction version is required (at most 40 characters).");
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(args.content));
    const sha256 = Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
    const current = await ownedResource(ctx, args.ownerUserId, args.resourcePath);
    if (current?.sha256 === sha256 && current.version === args.version) return { sha256, created: false };
    if (current && args.expectedSha256 !== current.sha256) throw new ConvexError("Instructions changed. Read the current resource before updating.");
    const now = Date.now();
    const data = { resourcePath: args.resourcePath, content: args.content, version: args.version, sha256, updatedAt: now };
    if (current) await ctx.db.patch(current._id, data);
    else await ctx.db.insert("agentInstructions", { ...data, ownerUserId: args.ownerUserId, createdAt: now });
    return { sha256, created: !current };
  },
});
