import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { FAST_LIMITS, fastCatalog, fastPostSchema } from "@/lib/mj-fast-helper";

// The Midjourney fast helper (extension ⌥F): start a fal run on a frame, poll
// it, keep a take (saved to the gallery with its lineage), drop it, or record
// the Seedance draft it became in Fantasy Studio.
//   GET  ?catalog=1&w=&h=&refs=   the models with a take's price on that frame
//   GET  ?ids=a,b                 those runs as they stand (the card polls this)
//   GET  ?recent=1                the last 20 runs
//   POST {action: start | save | review | fantasy}

const startRun = makeFunctionReference<"mutation">("mjQuickRuns:startRun");
const getRuns = makeFunctionReference<"query">("mjQuickRuns:getRuns");
const listRecent = makeFunctionReference<"query">("mjQuickRuns:listRecent");
const reviewTake = makeFunctionReference<"mutation">("mjQuickRuns:reviewTake");
const saveContext = makeFunctionReference<"query">("mjQuickRuns:saveContext");
const markSaved = makeFunctionReference<"mutation">("mjQuickRuns:markSaved");
const markFantasy = makeFunctionReference<"mutation">("mjQuickRuns:markFantasy");
const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
  "Cache-Control": "no-store",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });
const num = (value: string | null) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

type SaveContext = {
  alreadySaved?: string; resultUrl: string; width?: number; height?: number; contentType?: string; ingestKey: string;
  promptText: string; modelName: string; agentDescription: string; sourceUrl?: string; folderId?: string; upstreamAssetId?: string;
};

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const params = new URL(request.url).searchParams;
    if (params.get("catalog")) {
      return corsJson({ ok: true, ...fastCatalog(num(params.get("w")), num(params.get("h")), Math.min(num(params.get("refs")) ?? 0, FAST_LIMITS.refs)) });
    }
    const ownerUserId = resolveExtensionOwnerUserId();
    const client = getServerConvexClient(ownerUserId);
    const ids = (params.get("ids") || "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 30);
    if (ids.length) return corsJson({ ok: true, runs: await client.query(getRuns, { ownerUserId, ids }) });
    return corsJson({ ok: true, runs: await client.query(listRecent, { ownerUserId, limit: FAST_LIMITS.recent }) });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not read the fast helper's runs.") }, 400);
  }
}

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const client = getServerConvexClient(ownerUserId);
    const parsed = fastPostSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return corsJson({ error: parsed.error.issues[0]?.message || "Bad request." }, 400);
    const body = parsed.data;

    if (body.action === "start") {
      const { action: _action, ...rest } = body;
      void _action;
      const result = await client.mutation(startRun, { ownerUserId, ...rest });
      return corsJson({ ok: true, ...result });
    }
    if (body.action === "review") {
      const run = await client.mutation(reviewTake, { ownerUserId, runId: body.runId, index: body.index, review: body.review });
      return corsJson({ ok: true, run });
    }
    if (body.action === "fantasy") {
      const run = await client.mutation(markFantasy, { ownerUserId, runId: body.runId, index: body.index, draftId: body.draftId, project: body.project });
      return corsJson({ ok: true, run });
    }

    // save: the take as an asset in the world, with its lineage. The ingest key
    // is the run and take, so a second Keep returns the same asset.
    const context = (await client.query(saveContext, { ownerUserId, runId: body.runId, index: body.index })) as SaveContext;
    if (context.alreadySaved) {
      return corsJson({ ok: true, assetId: context.alreadySaved, already: true });
    }
    const folderId = body.folderId || context.folderId;
    const saved = (await client.action(ingestAction, {
      ownerUserId,
      url: context.resultUrl,
      ingestKey: context.ingestKey,
      promptText: context.promptText,
      agentDescription: context.agentDescription,
      tagNames: [body.section],
      modelName: context.modelName,
      modelProvider: "other",
      ...(context.sourceUrl ? { sourceUrl: context.sourceUrl, domain: context.sourceUrl } : {}),
      ...(folderId ? { folderId } : {}),
      ...(context.width ? { mediaWidth: context.width } : {}),
      ...(context.height ? { mediaHeight: context.height } : {}),
      generationType: "image_gen",
      promptType: "image_gen",
      assetRole: "generated_output",
      ingestSource: "import",
      ...(context.upstreamAssetId
        ? { upstreamInputs: [{ type: "asset", id: context.upstreamAssetId, role: "edit_source", notes: "Midjourney fast helper" }] }
        : {}),
    })) as { assetId?: string; error?: string; partial?: boolean };
    if (!saved.assetId) return corsJson({ error: saved.error || "The gallery did not save it." }, 400);
    const run = await client.mutation(markSaved, { ownerUserId, runId: body.runId, index: body.index, assetId: saved.assetId });
    return corsJson({ ok: true, assetId: saved.assetId, run, ...(saved.partial ? { partial: true } : {}) });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "The fast helper could not do that.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
