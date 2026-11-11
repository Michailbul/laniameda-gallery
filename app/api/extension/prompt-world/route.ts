import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { WRITER_BRIEF_LIMITS } from "@/lib/writer-brief";

// Which world a Midjourney command belongs to, read from its codes, and which
// of that world's files the writer would be given (convex/writerBrief.ts).
// The Grow card asks before it writes, so the world is on screen first.
// Returns names and labels only, never the files' text.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

const bodySchema = z.object({
  world: z.string().max(120).default("auto"),
  fallbackWorld: z.string().max(120).optional(),
  // The frame's Midjourney link: a frame already saved in a world names it.
  frame: z.string().max(600).optional(),
  command: z.string().max(WRITER_BRIEF_LIMITS.command).optional(),
  tier: z.enum(["full", "short"]).optional(),
});

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const input = bodySchema.parse(await request.json().catch(() => null));
    const result = await getServerConvexClient(ownerUserId).query(api.writerBrief.worldOf, { ownerUserId, ...input });
    return corsJson({ ok: true, ...result });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not read the world.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
