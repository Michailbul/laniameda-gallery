import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { downloadZip } from "client-zip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexTokenFor, resolveReviewViewer } from "@/lib/server/review-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Originals for the review page. R2's public address has no CORS, so the
// browser cannot fetch originals itself: this route checks the viewer (like
// the token route), asks Convex which of the frames the viewer may see, and
// streams them: one frame as the file itself, several as a ZIP built on the
// fly (client-zip pulls one file at a time, nothing is buffered whole).
//
//   GET  ?id=<assetId>            one original
//   POST ids=<id,id,…> (form)     a ZIP of originals

const noStore = { "Cache-Control": "no-store" };
const MAX_FILES = 500;
const ID = /^[a-z0-9]{20,40}$/;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const slugPart = (value?: string) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const extensionOf = (contentType: string | null, url: string) => {
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (EXTENSIONS[type]) return EXTENSIONS[type];
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url);
  return match ? match[1]!.toLowerCase() : "bin";
};

type Entry = { code: string; folder?: string; style?: string; url?: string };

const fileName = (entry: Entry, ext: string) =>
  [entry.code, slugPart(entry.folder), slugPart(entry.style)].filter(Boolean).join("_") + `.${ext}`;

const attachment = (name: string) => `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`;

const readIds = async (request: Request): Promise<string[]> => {
  if (request.method === "GET") {
    const url = new URL(request.url);
    return url.searchParams.getAll("id").flatMap((value) => value.split(","));
  }
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
    return Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  }
  const form = await request.formData().catch(() => null);
  return form ? form.getAll("ids").flatMap((value) => String(value).split(",")) : [];
};

async function handle(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const viewer = await resolveReviewViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });

  const ids = [...new Set((await readIds(request)).map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_FILES || ids.some((id) => !ID.test(id))) {
    return NextResponse.json({ error: "Choose between 1 and 500 frames." }, { status: 400, headers: noStore });
  }

  const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return NextResponse.json({ error: "Convex is not configured." }, { status: 500, headers: noStore });
  const client = new ConvexHttpClient(convexUrl);
  const token = convexTokenFor(viewer);
  if (token) client.setAuth(token);

  let list: Entry[] | null;
  try {
    list = await client.query(api.review.downloadList, { slug, assetIds: ids as Id<"assets">[] });
  } catch {
    return NextResponse.json({ error: "Those frames are not in this review." }, { status: 400, headers: noStore });
  }
  if (!list) return NextResponse.json({ error: "No access to this review." }, { status: 403, headers: noStore });
  // Every requested frame must be one the viewer may see.
  if (list.length !== ids.length || list.some((entry) => !entry.url)) {
    return NextResponse.json({ error: "Some of those frames are not in this review." }, { status: 403, headers: noStore });
  }

  if (list.length === 1) {
    const entry = list[0]!;
    const upstream = await fetch(entry.url!);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "The file could not be read." }, { status: 502, headers: noStore });
    }
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": attachment(fileName(entry, extensionOf(upstream.headers.get("content-type"), entry.url!))),
      ...noStore,
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    return new Response(upstream.body, { headers });
  }

  const entries = list;
  async function* files() {
    for (const entry of entries) {
      const upstream = await fetch(entry.url!).catch(() => null);
      if (!upstream?.ok || !upstream.body) continue;
      const modified = upstream.headers.get("last-modified");
      yield {
        name: fileName(entry, extensionOf(upstream.headers.get("content-type"), entry.url!)),
        input: upstream,
        lastModified: modified ? new Date(modified) : new Date(),
      };
    }
  }

  const zip = downloadZip(files());
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zip.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachment(`${slugPart(slug)}_${entries.length}-frames_${stamp}.zip`),
      ...noStore,
    },
  });
}

export const GET = handle;
export const POST = handle;
