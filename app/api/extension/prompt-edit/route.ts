import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { QUICK_EDIT_LIMITS } from "@/lib/mj-quick-edit";
import { LOCAL_WRITER_LIMITS } from "@/lib/local-writer";
import { WRITER_MODEL_KEYS, WRITER_RULES_LIMIT } from "@/lib/writer-models";

// Quick edit of a Midjourney prompt from the extension: the bar's prompt (and
// the selected part), a few words of instruction, the world's system prompt
// from the extension's settings. Returns the edited text; the extension puts
// it back in the bar. Nothing is sent to Midjourney.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

const bodySchema = z.object({
  prompt: z.string().min(1).max(QUICK_EDIT_LIMITS.prompt),
  selection: z.string().max(QUICK_EDIT_LIMITS.prompt).optional(),
  instruction: z.string().min(1).max(QUICK_EDIT_LIMITS.instruction),
  system: z.string().max(QUICK_EDIT_LIMITS.system).optional(),
  model: z.enum(WRITER_MODEL_KEYS).default("haiku"),
  // The art director's own system prompt for the quick edit (MJ settings → Writer).
  rules: z.string().max(WRITER_RULES_LIMIT).optional(),
  // "auto" reads the world from the prompt's own codes; fallbackWorld is the
  // world picked in the bar, used when the codes name none.
  world: z.string().max(120).optional(),
  fallbackWorld: z.string().max(120).optional(),
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
    const client = getServerConvexClient(ownerUserId);
    // An older backend takes only haiku or deepseek and no rules: retry with those.
    const result = await client.action(api.promptEditRunner.rewrite, { ownerUserId, ...input }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/validator|extra field/i.test(message) || !(input.rules || !["haiku", "deepseek"].includes(input.model))) throw error;
      const { rules: _rules, ...rest } = input;
      return client.action(api.promptEditRunner.rewrite, { ownerUserId, ...rest, model: input.model === "deepseek" ? "deepseek" : "haiku" });
    });
    return corsJson({ ok: true, ...result });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not edit the prompt.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
