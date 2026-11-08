import { getAppUser } from "@/lib/server/app-user";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { convexSiteUrl, mintServerActorToken } from "@/lib/server/convex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only door to a private inspiration original. The signed-in owner (the
// session cookie) or an owner agent token with gallery:read gets the bytes;
// anyone else gets 401, a wrong owner 404. Bytes come from the Convex HTTP
// action under a short-lived token minted here, and leave with
// `private, no-store` so no shared cache, CDN or browser disk keeps them.

const PRIVATE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie, Authorization",
};

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "content-disposition", "x-private-variant"];
const VARIANTS = new Set(["original", "display", "thumb"]);

const owner = async (request: Request) => {
  if (request.headers.get("authorization")) return (await requireAgentAuth(request, "gallery:read")).ownerUserId;
  return (await getAppUser())?.ownerUserId;
};

export async function GET(request: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  try {
    const { mediaId } = await params;
    const ownerUserId = await owner(request);
    if (!ownerUserId) return new Response("Sign in to see this.", { status: 401, headers: PRIVATE });
    const token = mintServerActorToken(ownerUserId);
    const site = convexSiteUrl();
    if (!token || !site) return new Response("Private media is not configured.", { status: 503, headers: PRIVATE });
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const range = request.headers.get("range");
    if (range) headers.Range = range;
    // ?variant=display|thumb = the clean copy (no EXIF / GPS); original only
    // when asked. Default: the clean copy when there is one. ?download=1 on
    // the original is Michael's export (attachment).
    const query = new URLSearchParams({ id: mediaId });
    const search = new URL(request.url).searchParams;
    const variant = search.get("variant");
    if (variant && VARIANTS.has(variant)) query.set("variant", variant);
    if (search.get("download") === "1") query.set("download", "1");
    const upstream = await fetch(`${site}/inspiration/private-media?${query}`, { headers, cache: "no-store" });
    const out = new Headers(PRIVATE);
    for (const name of PASS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    if (!upstream.ok && upstream.status !== 206) {
      const status = upstream.status === 401 || upstream.status === 404 || upstream.status === 416 ? upstream.status : 502;
      return new Response(status === 404 ? "Not found." : status === 416 ? null : "Could not read this file.", { status, headers: out });
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (error) {
    if (error instanceof AgentAuthError) return new Response(error.message, { status: error.status, headers: PRIVATE });
    return new Response("Could not read this file.", { status: 500, headers: PRIVATE });
  }
}
