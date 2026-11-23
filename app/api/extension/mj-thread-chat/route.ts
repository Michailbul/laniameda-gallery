import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { LOCAL_WRITER_LIMITS } from "@/lib/local-writer";
import { MJ_QUEUE_LIMITS } from "@/lib/mj-queue";
import { WRITER_MODEL_KEYS, WRITER_PROVIDERS, WRITER_RULES_LIMIT } from "@/lib/writer-models";

// The agent in an MJ Queue thread's chat (extension side panel, 23 Nov 2026).
// Michael's message is already in the chat (/api/extension/mj-queue action
// "chat"); this runs the writer on it where he picked (This Mac: stage
// "messages", the bridge writes, stage "finish"; or Cloud · fal / Cloud ·
// Pika) and applies what it answers to the thread. Nothing is sent to
// Midjourney.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

const bodySchema = z.object({
  batch: z.string().trim().min(1).max(MJ_QUEUE_LIMITS.batch),
  messageId: z.string().trim().min(1).max(80),
  model: z.enum(WRITER_MODEL_KEYS).default("haiku"),
  provider: z.enum(WRITER_PROVIDERS).optional(),
  rules: z.string().max(WRITER_RULES_LIMIT).optional(),
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
    const result = await getServerConvexClient(ownerUserId).action(api.mjThreadChat.answer, { ownerUserId, ...input });
    return corsJson({ ok: true, ...result });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "The agent could not answer.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
