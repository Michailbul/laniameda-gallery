import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { DESCRIBE_LIMITS, DESCRIBE_MODES } from "@/lib/mj-describe";
import { LOCAL_WRITER_LIMITS } from "@/lib/local-writer";

// The extension's describer: a picture (and Midjourney's Describe lines when
// it caught them) into our Midjourney prompt, by the quick-edit agent
// (convex/promptEditRunner.ts describe). Nothing is sent to Midjourney.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

const bodySchema = z.object({
  image: z.string().min(12).max(DESCRIBE_LIMITS.image),
  descriptions: z.array(z.string().max(DESCRIBE_LIMITS.description)).max(DESCRIBE_LIMITS.descriptions).optional(),
  aspect: z.string().max(20).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  mode: z.enum(DESCRIBE_MODES).default("both"),
  style: z.string().max(120).optional(),
  system: z.string().max(DESCRIBE_LIMITS.system).optional(),
  note: z.string().max(DESCRIBE_LIMITS.note).optional(),
  local: z.object({
    stage: z.enum(["messages", "finish"]),
    raw: z.string().max(LOCAL_WRITER_LIMITS.raw).optional(),
    model: z.string().max(60).optional(),
    ms: z.number().nonnegative().optional(),
  }).optional(),
});

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const input = bodySchema.parse(await request.json().catch(() => null));
    const result = await getServerConvexClient(ownerUserId).action(api.promptEditRunner.describe, { ownerUserId, ...input });
    return corsJson({ ok: true, ...result });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not describe the picture.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
