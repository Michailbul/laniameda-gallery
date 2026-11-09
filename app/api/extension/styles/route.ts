import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";

// A world's named styles for the extension's describer ("in our style"): the
// same records as the gallery's styles page and list_styles, so presets come
// from one source. The describer reads each style's lock and recipe on the
// server when it runs.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const world = new URL(request.url).searchParams.get("world")?.trim();
    if (!world) return corsJson({ error: "Name a world." }, 400);
    const ownerUserId = resolveExtensionOwnerUserId();
    const result = await getServerConvexClient(ownerUserId).query(api.worldStyles.listStyles, { ownerUserId, world, coverLimit: 1 });
    return corsJson({
      ok: true,
      world: result.world,
      universe: result.universe,
      styles: result.styles
        .filter((style) => style.status !== "archived" && style.status !== "merged")
        .map((style) => ({
          id: String(style.id), name: style.name, line: style.line ?? null, family: style.family,
          world: style.world.key, worldShort: style.world.short, status: style.status,
          recipe: style.recipe ?? null, hasLock: style.hasLock, frames: style.frameCount,
          thumbUrl: style.covers[0]?.thumbUrl ?? null,
        })),
    });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not load the styles.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
