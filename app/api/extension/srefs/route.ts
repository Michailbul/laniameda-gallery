import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { etagJson } from "@/lib/server/etag-json";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { extractMidjourneySrefs } from "@/lib/midjourney-srefs";
import { clientErrorMessage } from "@/lib/server/route-error";

// The style references a world already uses, for the extension's "Rerun
// random" on a Midjourney job (mj-rerun.js): the --sref codes in the recipes
// of the world's named styles, then its style presets. Read only.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};
const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });
const MAX_SREFS = 40;
const MAX_STYLES = 24;

type Sref = { code: string; label: string; from: "style" | "preset" };

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const world = new URL(request.url).searchParams.get("world")?.trim();
    if (!world) return corsJson({ error: "Name a world." }, 400);
    const ownerUserId = resolveExtensionOwnerUserId();
    const client = getServerConvexClient(ownerUserId);
    const out = new Map<string, Sref>();
    const add = (code: string, label: string, from: Sref["from"]) => {
      const clean = code.trim();
      if (clean && !out.has(clean) && out.size < MAX_SREFS) out.set(clean, { code: clean, label, from });
    };

    const listed = await client.query(api.worldStyles.listStyles, { ownerUserId, world, coverLimit: 0 });
    const styles = listed.styles.filter((style) => style.status !== "archived" && style.status !== "merged").slice(0, MAX_STYLES);
    const details = await Promise.all(styles.map((style) =>
      client.query(api.worldStyles.getStyle, { ownerUserId, style: String(style.id), world }).catch(() => null)));
    for (const style of details) {
      if (!style) continue;
      for (const recipe of style.recipes) {
        for (const ref of extractMidjourneySrefs(recipe.parameters)) {
          for (const code of ref.parameters.replace(/^--sref\s+/, "").split(/\s+--/)[0].split(/\s+/)) add(code, style.name, "style");
        }
      }
    }
    try {
      const presets = await client.query(api.promptGrid.listPresets, { ownerUserId, world });
      for (const preset of presets) for (const sref of preset.srefs) add(sref.code, preset.name, "preset");
    } catch {
      // presets are optional; the styles' codes are enough
    }
    return etagJson(request, { ok: true, world, srefs: [...out.values()] }, CORS_HEADERS);
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not load the world's style references.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
