import { ConvexError, v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { agentTokenScopeValidator } from "./validators";

type AgentTokenScope = Infer<typeof agentTokenScopeValidator>;

const agentTokenPublicValidator = v.object({
  _id: v.id("agentTokens"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  tokenPrefix: v.string(),
  label: v.string(),
  scopes: v.array(agentTokenScopeValidator),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const authenticatedTokenValidator = v.object({
  tokenId: v.id("agentTokens"),
  ownerUserId: v.string(),
  tokenPrefix: v.string(),
  label: v.string(),
  scopes: v.array(agentTokenScopeValidator),
});

const resolveIssuerSecret = () =>
  (
    process.env.AGENT_TOKEN_ISSUER_SECRET ??
    process.env.CURATION_ADMIN_SECRET ??
    ""
  ).trim();

const assertServerSecret = (serverSecret: string) => {
  const expected = resolveIssuerSecret();
  if (!expected) {
    throw new ConvexError("AGENT_TOKEN_ISSUER_SECRET is not configured.");
  }
  if (serverSecret !== expected) {
    throw new ConvexError("Invalid agent token issuer secret.");
  }
};

const normalizeLabel = (label: string | undefined) => {
  const trimmed = label?.trim();
  return trimmed || "Agent token";
};

const normalizeScopes = (scopes: AgentTokenScope[] | undefined) => {
  const values: AgentTokenScope[] =
    scopes && scopes.length > 0 ? scopes : ["gallery:read", "gallery:write"];
  return Array.from(new Set(values));
};

const toPublicToken = (token: Doc<"agentTokens">) => ({
  _id: token._id,
  _creationTime: token._creationTime,
  ownerUserId: token.ownerUserId,
  tokenPrefix: token.tokenPrefix,
  label: token.label,
  scopes: token.scopes,
  expiresAt: token.expiresAt,
  revokedAt: token.revokedAt,
  lastUsedAt: token.lastUsedAt,
  createdAt: token.createdAt,
  updatedAt: token.updatedAt,
});

export const createAgentToken = mutation({
  args: {
    serverSecret: v.string(),
    ownerUserId: v.string(),
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    label: v.optional(v.string()),
    scopes: v.optional(v.array(agentTokenScopeValidator)),
    expiresAt: v.optional(v.number()),
  },
  returns: agentTokenPublicValidator,
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const ownerUserId = args.ownerUserId.trim();
    const tokenHash = args.tokenHash.trim();
    const tokenPrefix = args.tokenPrefix.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (!tokenHash || !tokenPrefix) {
      throw new ConvexError("tokenHash and tokenPrefix are required.");
    }

    const existing = await ctx.db
      .query("agentTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (existing) {
      throw new ConvexError("Agent token already exists.");
    }

    const now = Date.now();
    const tokenId = await ctx.db.insert("agentTokens", {
      ownerUserId,
      tokenHash,
      tokenPrefix,
      label: normalizeLabel(args.label),
      scopes: normalizeScopes(args.scopes),
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    const token = await ctx.db.get(tokenId);
    if (!token) {
      throw new ConvexError("Failed to create agent token.");
    }
    return toPublicToken(token);
  },
});

export const listAgentTokens = query({
  args: {
    serverSecret: v.string(),
    ownerUserId: v.string(),
    includeRevoked: v.optional(v.boolean()),
  },
  returns: v.array(agentTokenPublicValidator),
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const rows = await ctx.db
      .query("agentTokens")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerUserId))
      .order("desc")
      .collect();

    return rows
      .filter((row) => args.includeRevoked || !row.revokedAt)
      .map(toPublicToken);
  },
});

export const revokeAgentToken = mutation({
  args: {
    serverSecret: v.string(),
    ownerUserId: v.string(),
    tokenId: v.id("agentTokens"),
  },
  returns: v.object({
    tokenId: v.id("agentTokens"),
    revoked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const token = await ctx.db.get(args.tokenId);
    if (!token || token.ownerUserId !== ownerUserId) {
      throw new ConvexError("Agent token not found.");
    }

    if (token.revokedAt) {
      return { tokenId: args.tokenId, revoked: false };
    }

    await ctx.db.patch(args.tokenId, {
      revokedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { tokenId: args.tokenId, revoked: true };
  },
});

export const authenticateAgentToken = mutation({
  args: {
    tokenHash: v.string(),
    requiredScope: v.optional(agentTokenScopeValidator),
  },
  returns: v.union(v.null(), authenticatedTokenValidator),
  handler: async (ctx, args) => {
    const tokenHash = args.tokenHash.trim();
    if (!tokenHash) {
      return null;
    }

    const token = await ctx.db
      .query("agentTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!token) {
      return null;
    }

    const now = Date.now();
    if (token.revokedAt || (token.expiresAt && token.expiresAt <= now)) {
      return null;
    }
    if (args.requiredScope && !token.scopes.includes(args.requiredScope)) {
      return null;
    }

    await ctx.db.patch(token._id, {
      lastUsedAt: now,
      updatedAt: now,
    });

    return {
      tokenId: token._id,
      ownerUserId: token.ownerUserId,
      tokenPrefix: token.tokenPrefix,
      label: token.label,
      scopes: token.scopes,
    };
  },
});
