import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { resolveUserIdCandidates } from "./authz";

// Settings → keys and connections. The secrets themselves are sealed and
// opened in convex/providerVault.ts ("use node"); this file only stores rows
// and tells the Settings page and the edit panel what is set, never the secret.
// A key saved here wins over the deployment's FAL_KEY / PIKA_API_KEY.

export const credentialProviderValidator = v.union(v.literal("fal"), v.literal("pika"), v.literal("magnific"));
export type CredentialProvider = Doc<"providerCredentials">["provider"];
export const CREDENTIAL_PROVIDERS: readonly CredentialProvider[] = ["magnific", "fal", "pika"];

const serverKey = (provider: CredentialProvider) =>
  provider === "fal" ? Boolean(process.env.FAL_KEY?.trim())
    : provider === "pika" ? Boolean(process.env.PIKA_API_KEY?.trim())
    : false;

export const credentialRows = async (ctx: QueryCtx, owner: string) => {
  const rows = new Map<CredentialProvider, Doc<"providerCredentials">>();
  for (const candidate of resolveUserIdCandidates(owner)) {
    for (const provider of CREDENTIAL_PROVIDERS) {
      if (rows.has(provider)) continue;
      const row = await ctx.db.query("providerCredentials")
        .withIndex("by_owner_provider", (q) => q.eq("ownerUserId", candidate).eq("provider", provider))
        .first();
      if (row) rows.set(provider, row);
    }
  }
  return rows;
};

/** Whether each provider can take a job now, and since when its credential is set. */
export const credentialPresence = async (ctx: QueryCtx, owner: string) => {
  const rows = await credentialRows(ctx, owner);
  return Object.fromEntries(CREDENTIAL_PROVIDERS.map((provider) => {
    const row = rows.get(provider);
    return [provider, { key: Boolean(row) || serverKey(provider), since: row?.updatedAt }];
  })) as Record<CredentialProvider, { key: boolean; since?: number }>;
};

const statusValidator = v.object({
  provider: credentialProviderValidator,
  /** app = saved in Settings, server = the deployment's environment, none = missing. */
  source: v.union(v.literal("app"), v.literal("server"), v.literal("none")),
  hint: v.optional(v.string()),
  account: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  checkedAt: v.optional(v.number()),
  serverKey: v.boolean(),
});

export const listProviderCredentials = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(statusValidator),
  handler: async (ctx, args) => {
    const rows = await credentialRows(ctx, args.ownerUserId);
    return CREDENTIAL_PROVIDERS.map((provider) => {
      const row = rows.get(provider);
      const server = serverKey(provider);
      return {
        provider,
        source: row ? "app" as const : server ? "server" as const : "none" as const,
        ...(row?.hint ? { hint: row.hint } : {}),
        ...(row?.account ? { account: row.account } : {}),
        ...(row ? { updatedAt: row.updatedAt } : {}),
        ...(row?.checkedAt ? { checkedAt: row.checkedAt } : {}),
        serverKey: server,
      };
    });
  },
});

/** Forget a key or sign-in saved in Settings; a server key, if any, takes over. */
export const removeProviderCredential = ownerMutation({
  args: { ownerUserId: v.string(), provider: credentialProviderValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = (await credentialRows(ctx, args.ownerUserId)).get(args.provider);
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

export const getSealed = internalQuery({
  args: { ownerUserId: v.string(), provider: credentialProviderValidator },
  returns: v.union(v.null(), v.object({ sealed: v.string(), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    const row = (await credentialRows(ctx, args.ownerUserId)).get(args.provider);
    return row ? { sealed: row.sealed, updatedAt: row.updatedAt } : null;
  },
});

export const putSealed = internalMutation({
  args: {
    ownerUserId: v.string(),
    provider: credentialProviderValidator,
    sealed: v.string(),
    hint: v.optional(v.string()),
    account: v.optional(v.string()),
    /** A token refresh: keep the row's identity and do not count it as a new credential. */
    refresh: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = (await credentialRows(ctx, args.ownerUserId)).get(args.provider);
    if (row) {
      await ctx.db.patch(row._id, {
        sealed: args.sealed,
        ...(args.refresh ? {} : { hint: args.hint, account: args.account ?? row.account, updatedAt: now }),
        checkedAt: now,
      });
      return null;
    }
    if (args.refresh) return null; // disconnected meanwhile: do not bring it back
    await ctx.db.insert("providerCredentials", {
      ownerUserId: args.ownerUserId,
      provider: args.provider,
      sealed: args.sealed,
      ...(args.hint ? { hint: args.hint } : {}),
      ...(args.account ? { account: args.account } : {}),
      checkedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markChecked = internalMutation({
  args: { ownerUserId: v.string(), provider: credentialProviderValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = (await credentialRows(ctx, args.ownerUserId)).get(args.provider);
    if (row) await ctx.db.patch(row._id, { checkedAt: Date.now() });
    return null;
  },
});
