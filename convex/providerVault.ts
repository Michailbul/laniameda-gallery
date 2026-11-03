"use node";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ConvexError, v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { signedOwnerAction as ownerAction } from "./actor";
import {
  MAGNIFIC_CLIENT_ID, MagnificAuthError, exchangeMagnificToken, openMagnificSession, refreshMagnificTokens,
  type MagnificTokens,
} from "../lib/magnific-mcp";

// Settings → keys and connections, the secret half. A key or sign-in is sealed
// with AES-256-GCM under a key derived from PROVIDER_KEYS_SECRET (or, until
// that is set, AGENT_TOKEN_ISSUER_SECRET) and stored in providerCredentials.
// The edit runner opens it here; nothing returns a secret to a client.

const keyProviderValidator = v.union(v.literal("fal"), v.literal("pika"));
type KeyProvider = "fal" | "pika";

const vaultKey = () => {
  const secret = process.env.PROVIDER_KEYS_SECRET?.trim() || process.env.AGENT_TOKEN_ISSUER_SECRET?.trim();
  if (!secret) throw new ConvexError("The deployment has no PROVIDER_KEYS_SECRET to seal keys with.");
  return createHash("sha256").update(`laniameda-provider-credentials:${secret}`).digest();
};

const seal = (plain: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
};

const open = (sealed: string) => {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unreadable sealed credential.");
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
};

const envKey = (provider: KeyProvider) =>
  (provider === "fal" ? process.env.FAL_KEY : process.env.PIKA_API_KEY)?.trim() || undefined;

/** The key a job runs on: the one saved in Settings, else the deployment's. */
export async function resolveProviderKey(ctx: ActionCtx, owner: string, provider: KeyProvider) {
  const row = await ctx.runQuery(internal.providerCredentials.getSealed, { ownerUserId: owner, provider });
  if (row) {
    try { return open(row.sealed); } catch { /* re-sealed under another secret: fall back */ }
  }
  return envKey(provider);
}

const readTokens = async (ctx: ActionCtx, owner: string) => {
  const row = await ctx.runQuery(internal.providerCredentials.getSealed, { ownerUserId: owner, provider: "magnific" });
  if (!row) return undefined;
  try { return JSON.parse(open(row.sealed)) as MagnificTokens; } catch { return undefined; }
};

/**
 * A live Magnific access token for the owner, refreshed when it is about to
 * expire. Undefined when Magnific is not connected. Two jobs refreshing at
 * once: the loser re-reads the winner's tokens.
 */
export async function magnificAccessToken(ctx: ActionCtx, owner: string, force = false): Promise<string | undefined> {
  const tokens = await readTokens(ctx, owner);
  if (!tokens) return undefined;
  if (!force && tokens.expiresAt - Date.now() > 60 * 1000) return tokens.accessToken;
  try {
    const next = await refreshMagnificTokens(tokens);
    await ctx.runMutation(internal.providerCredentials.putSealed, {
      ownerUserId: owner, provider: "magnific", sealed: seal(JSON.stringify(next)), refresh: true,
    });
    return next.accessToken;
  } catch (error) {
    const latest = await readTokens(ctx, owner);
    if (latest && latest.accessToken !== tokens.accessToken && latest.expiresAt - Date.now() > 60 * 1000) return latest.accessToken;
    throw error;
  }
}

const checkKey = async (provider: KeyProvider, key: string) => {
  if (provider === "fal") {
    // A made-up request id: 404 means the key is good, 401 that it is not. Costs nothing.
    const response = await fetch("https://queue.fal.run/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status", {
      headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, message: "fal refused this key." };
    return { ok: true, message: "fal accepts this key." };
  }
  const response = await fetch("https://api.dev.pika.art/billing/balance", {
    headers: { "X-API-Key": key }, signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401 || response.status === 403) return { ok: false, message: "Pika refused this key." };
  const body = await response.json().catch(() => null) as { balance_micro_usd?: number } | null;
  const balanceUsd = typeof body?.balance_micro_usd === "number" ? body.balance_micro_usd / 1e6 : undefined;
  return {
    ok: true,
    message: balanceUsd === undefined ? "Pika accepts this key." : `Pika accepts this key · $${balanceUsd.toFixed(2)} left.`,
    ...(balanceUsd === undefined ? {} : { balanceUsd }),
  };
};

const checkResult = v.object({
  ok: v.boolean(),
  message: v.string(),
  balanceUsd: v.optional(v.number()),
  credits: v.optional(v.number()),
  account: v.optional(v.string()),
});

/** Save a fal or Pika key from Settings after the provider accepts it. */
export const saveProviderKey = ownerAction({
  args: { ownerUserId: v.string(), provider: keyProviderValidator, key: v.string() },
  returns: checkResult,
  handler: async (ctx, args) => {
    const key = args.key.trim();
    if (key.length < 12 || key.length > 400 || /\s/.test(key)) throw new ConvexError("That does not look like an API key.");
    const check = await checkKey(args.provider, key);
    if (!check.ok) return check;
    await ctx.runMutation(internal.providerCredentials.putSealed, {
      ownerUserId: args.ownerUserId, provider: args.provider, sealed: seal(key), hint: key.slice(-4),
    });
    return { ...check, message: `Saved. ${check.message}` };
  },
});

const magnificAccount = async (accessToken: string) => {
  const session = await openMagnificSession(accessToken);
  const profile = await session.call("account_profile", {}).catch(() => ({} as Record<string, unknown>));
  const balance = await session.call("account_balance", {}).catch(() => ({} as Record<string, unknown>));
  const account = [profile.email, profile.displayName, profile.name].find((value) => typeof value === "string" && value) as string | undefined;
  const credits = (balance.credits as { available?: number } | undefined)?.available;
  return { account, credits: typeof credits === "number" ? credits : undefined };
};

/** Test the key or sign-in in effect now (Settings → Check). */
export const checkProvider = ownerAction({
  args: { ownerUserId: v.string(), provider: v.union(keyProviderValidator, v.literal("magnific")) },
  returns: checkResult,
  handler: async (ctx, args) => {
    if (args.provider === "magnific") {
      try {
        const token = await magnificAccessToken(ctx, args.ownerUserId);
        if (!token) return { ok: false, message: "Magnific is not connected." };
        const { account, credits } = await magnificAccount(token);
        await ctx.runMutation(internal.providerCredentials.markChecked, { ownerUserId: args.ownerUserId, provider: "magnific" });
        // The cheapest Magnific edit is 65 credits; below that every edit falls through to fal / Pika.
        const short = credits !== undefined && credits < 65;
        return {
          ok: !short,
          message: `Connected${account ? ` as ${account}` : ""}${credits === undefined ? "" : ` · ${credits.toLocaleString("en")} credits`}`
            + (short ? " left, too few for an edit: edits run on fal and Pika until you top up." : "."),
          ...(account ? { account } : {}),
          ...(credits === undefined ? {} : { credits }),
        };
      } catch (error) {
        return { ok: false, message: error instanceof MagnificAuthError ? "The Magnific sign-in expired. Connect it again." : `Magnific: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
      }
    }
    const key = await resolveProviderKey(ctx, args.ownerUserId, args.provider);
    if (!key) return { ok: false, message: "No key set." };
    const check = await checkKey(args.provider, key);
    if (check.ok) await ctx.runMutation(internal.providerCredentials.markChecked, { ownerUserId: args.ownerUserId, provider: args.provider });
    return check;
  },
});

/** Finish Settings → Connect Magnific: trade the code for tokens and keep them sealed. */
export const connectMagnific = ownerAction({
  args: { ownerUserId: v.string(), code: v.string(), codeVerifier: v.string(), redirectUri: v.string() },
  returns: v.object({ account: v.optional(v.string()), credits: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const tokens = await exchangeMagnificToken({
      grant_type: "authorization_code",
      code: args.code,
      code_verifier: args.codeVerifier,
      redirect_uri: args.redirectUri,
      client_id: MAGNIFIC_CLIENT_ID,
    });
    const { account, credits } = await magnificAccount(tokens.accessToken).catch(() => ({ account: undefined, credits: undefined }));
    await ctx.runMutation(internal.providerCredentials.putSealed, {
      ownerUserId: args.ownerUserId, provider: "magnific", sealed: seal(JSON.stringify(tokens)), account,
    });
    return { ...(account ? { account } : {}), ...(credits === undefined ? {} : { credits }) };
  },
});
