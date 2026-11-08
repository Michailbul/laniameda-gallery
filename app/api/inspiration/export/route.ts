import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";
import { GALLERY_ORIGIN } from "@/lib/gallery-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Michael's export of his private originals: one JSON record per file (what
// it is, its hash, which reference it belongs to, and the gated link to its
// bytes; ?variant=original&download=1 downloads the original). Signed-in
// session only: an agent token gets 401 here.

const PRIVATE = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  if (request.headers.get("authorization")) {
    return NextResponse.json({ error: "Export is for Michael's signed-in session only." }, { status: 401, headers: PRIVATE });
  }
  const user = await getAppUser();
  if (!user?.ownerUserId) return NextResponse.json({ error: "Sign in to export." }, { status: 401, headers: PRIVATE });
  const client = getServerConvexClient(user.ownerUserId);
  const rows = await client.query(api.inspirationPrivate.listPrivateMediaForExport, { ownerUserId: user.ownerUserId });
  const files = rows.map((row) => ({
    ...row,
    original: `${GALLERY_ORIGIN}${row.url}?variant=original&download=1`,
    ...(row.displayUrl ? { display: `${GALLERY_ORIGIN}${row.displayUrl}` } : {}),
  }));
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), count: files.length, files }, null, 2), {
    status: 200,
    headers: { ...PRIVATE, "Content-Type": "application/json", "Content-Disposition": `attachment; filename="private-originals-${date}.json"` },
  });
}
