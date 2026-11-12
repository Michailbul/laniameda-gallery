#!/usr/bin/env bun
// Mint, list or revoke a guest reader token (guest:read): read-only, limited
// to chosen root collections, never a world. See
// skills/laniameda-gallery/references/guest-tokens.md.
//
//   bun scripts/guest-token.ts mint --label "Name · purpose (read-only)" \
//     --roots <rootId>,<rootId> --out ~/.config/laniameda/<name>-gallery-token [--days 365]
//   bun scripts/guest-token.ts list
//   bun scripts/guest-token.ts revoke --id <tokenId>
//
// Needs CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL), AGENT_TOKEN_ISSUER_SECRET and
// GALLERY_OWNER_USER_ID in the environment. The raw token is written only to
// --out (mode 600) and is never printed.

import { chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createAgentTokenSecret, hashAgentToken, tokenPrefix } from "../lib/server/agent-auth";

const createRef = makeFunctionReference<"mutation">("agentTokens:createAgentToken");
const listRef = makeFunctionReference<"query">("agentTokens:listAgentTokens");
const revokeRef = makeFunctionReference<"mutation">("agentTokens:revokeAgentToken");

const need = (name: string, value: string | undefined) => {
  if (!value?.trim()) throw new Error(`${name} is not set.`);
  return value.trim();
};

const flag = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};

const main = async () => {
  const command = process.argv[2];
  const client = new ConvexHttpClient(need("CONVEX_URL", process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL));
  const serverSecret = need("AGENT_TOKEN_ISSUER_SECRET", process.env.AGENT_TOKEN_ISSUER_SECRET);
  const ownerUserId = need("GALLERY_OWNER_USER_ID", process.env.GALLERY_OWNER_USER_ID);

  if (command === "mint") {
    const label = need("--label", flag("label"));
    const roots = need("--roots", flag("roots")).split(",").map((id) => id.trim()).filter(Boolean);
    const out = need("--out", flag("out")).replace(/^~(?=\/)/, homedir());
    const days = Number(flag("days") ?? 0);
    const raw = createAgentTokenSecret();
    const token = (await client.mutation(createRef, {
      serverSecret, ownerUserId, label,
      tokenHash: hashAgentToken(raw),
      tokenPrefix: tokenPrefix(raw),
      scopes: ["guest:read"],
      allowedRootIds: roots,
      ...(days > 0 ? { expiresAt: Date.now() + days * 86_400_000 } : {}),
    })) as { _id: string; tokenPrefix: string; allowedRootIds?: string[] };
    writeFileSync(out, `${raw}\n`, { mode: 0o600 });
    chmodSync(out, 0o600);
    console.log(JSON.stringify({ minted: true, tokenId: token._id, tokenPrefix: token.tokenPrefix, allowedRoots: token.allowedRootIds?.length ?? 0, file: out }));
    return;
  }

  if (command === "list") {
    const tokens = (await client.query(listRef, { serverSecret, ownerUserId })) as Array<Record<string, unknown> & { scopes: string[] }>;
    const guests = tokens.filter((token) => token.scopes.includes("guest:read"))
      .map(({ _id, label, tokenPrefix: prefix, allowedRootIds, lastUsedAt, expiresAt }) => ({ _id, label, tokenPrefix: prefix, allowedRootIds, lastUsedAt, expiresAt }));
    console.log(JSON.stringify(guests, null, 2));
    return;
  }

  if (command === "revoke") {
    const tokenId = need("--id", flag("id"));
    console.log(JSON.stringify(await client.mutation(revokeRef, { serverSecret, ownerUserId, tokenId })));
    return;
  }

  throw new Error("Usage: bun scripts/guest-token.ts mint|list|revoke (see the header).");
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
