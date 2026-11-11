import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { EXPAND_LIMITS, EXPAND_PRESETS, EXPAND_PRESET_KEYS } from "@/lib/mj-expand";
import { LOCAL_WRITER_LIMITS } from "@/lib/local-writer";

// The extension's writer: one Midjourney frame (the picture and the command
// that made it) grown into more prompts in the same look, by the quick-edit
// agent (convex/promptEditRunner.ts expand). GET lists the moves. Nothing is
// sent to Midjourney.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

const bodySchema = z.object({
  image: z.string().min(12).max(EXPAND_LIMITS.image),
  command: z.string().max(EXPAND_LIMITS.command).optional(),
  preset: z.enum(EXPAND_PRESET_KEYS).optional(),
  idea: z.string().max(EXPAND_LIMITS.idea).optional(),
  count: z.number().int().min(1).max(EXPAND_LIMITS.maxCount).optional(),
  world: z.string().max(120).optional(),
  system: z.string().max(EXPAND_LIMITS.system).optional(),
  keepImages: z.boolean().optional(),
  srefUrl: z.string().url().max(2048).optional(),
  aspect: z.string().max(20).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  local: z.object({
    stage: z.enum(["messages", "finish"]),
    raw: z.string().max(LOCAL_WRITER_LIMITS.raw).optional(),
    model: z.string().max(60).optional(),
    ms: z.number().nonnegative().optional(),
  }).optional(),
});

export async function GET(request: Request) {
  if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
  return corsJson({ ok: true, presets: EXPAND_PRESETS.map(({ key, label, count, hint }) => ({ key, label, count, hint })) });
}

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const input = bodySchema.parse(await request.json().catch(() => null));
    const result = await getServerConvexClient(ownerUserId).action(api.promptEditRunner.expand, { ownerUserId, ...input });
    return corsJson({ ok: true, ...result });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not write the prompts.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
