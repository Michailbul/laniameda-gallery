import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";

// The cloud writer's own keys, from the extension (MJ settings → Writer →
// Cloud keys). GET says which fal and Pika key the writer uses (saved here,
// the gallery's own, or none), tested, with its balance (free reads). POST saves a new key once the provider accepts it and it has
// credit (convex/providerVault.ts saveProviderKey). The key is sealed in the
// gallery and never sent back: only its last four characters.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};
const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

const PROVIDERS = ["fal", "pika"] as const;
type KeyProvider = (typeof PROVIDERS)[number];
const isKeyProvider = (value: string): value is KeyProvider => (PROVIDERS as readonly string[]).includes(value);

const bodySchema = z.object({
  provider: z.enum(PROVIDERS),
  key: z.string().trim().min(12).max(400),
});

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const client = getServerConvexClient(ownerUserId);
    const rows = await client.query(api.providerCredentials.listProviderCredentials, { ownerUserId });
    const keys = await Promise.all(rows.flatMap((row) => {
      const provider = row.provider;
      if (!isKeyProvider(provider)) return [];
      return [(async () => ({
        provider,
        source: row.source,
        hint: row.hint,
        updatedAt: row.updatedAt,
        check: row.source !== "none"
          ? await client.action(api.providerVault.checkProvider, { ownerUserId, provider }).catch(() => null)
          : null,
      }))()];
    }));
    return corsJson({ ok: true, keys });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not read the writer's keys.") }, 400);
  }
}

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const input = bodySchema.parse(await request.json().catch(() => null));
    const client = getServerConvexClient(ownerUserId);
    const result = await client.action(api.providerVault.saveProviderKey, { ownerUserId, ...input });
    // ok:false here is the provider's own answer (refused, no credit): a 200 with the message.
    return corsJson({ saved: result.ok, ...result, ok: true });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not save the key.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
