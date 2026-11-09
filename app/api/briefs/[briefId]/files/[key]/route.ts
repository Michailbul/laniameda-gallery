import { api } from "@/convex/_generated/api";
import { getAppUser } from "@/lib/server/app-user";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only door to a production brief's file (the PDF, the script, the
// storyboard). The signed-in owner (session cookie) or an owner agent token
// with gallery:read gets the bytes; anyone else 401, a wrong owner 404. The
// storage address stays on the server; bytes leave `private, no-store`.

const PRIVATE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie, Authorization",
};

const ownerOf = async (request: Request) => {
  if (request.headers.get("authorization")) return (await requireAgentAuth(request, "gallery:read")).ownerUserId;
  return (await getAppUser())?.ownerUserId;
};

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

export async function GET(request: Request, { params }: { params: Promise<{ briefId: string; key: string }> }) {
  try {
    const { briefId, key } = await params;
    const ownerUserId = await ownerOf(request);
    if (!ownerUserId) return new Response("Sign in to see this.", { status: 401, headers: PRIVATE });
    const search = new URL(request.url).searchParams;
    const file = await getServerConvexClient(ownerUserId).query(api.projects.briefFile, {
      ownerUserId, briefId, key: decodeURIComponent(key), cover: search.get("cover") === "1",
    });
    if (!file) return new Response("Not found.", { status: 404, headers: PRIVATE });
    const upstream = await fetch(file.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) return new Response("Could not read this file.", { status: 502, headers: PRIVATE });
    const headers = new Headers(PRIVATE);
    headers.set("Content-Type", file.contentType);
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    const disposition = search.get("download") === "1" ? "attachment" : "inline";
    headers.set("Content-Disposition", `${disposition}; filename="${asciiName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof AgentAuthError) return new Response(error.message, { status: error.status, headers: PRIVATE });
    return new Response("Could not read this file.", { status: 500, headers: PRIVATE });
  }
}
