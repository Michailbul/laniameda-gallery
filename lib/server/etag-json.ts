import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

// JSON for endpoints the extension polls (MJ Queue every few seconds, the
// moodboard dock on every prompt). The body carries an ETag; a poll whose
// If-None-Match still matches gets an empty 304 instead of the same JSON
// again. The browser's HTTP cache sends If-None-Match and hands the cached
// body back to fetch() by itself, so no client change is needed.
// Why: the queue is ~1.2 MB and was re-sent ~2,000 times an hour, which used
// up the Vercel Hobby plan's 10 GB of Fast Origin Transfer (15 Nov 2026).
export function etagJson(request: Request, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  const etag = `W/"${createHash("sha1").update(text).digest("base64url")}"`;
  const cacheHeaders = {
    ...headers,
    ETag: etag,
    // private: never stored on the CDN (the response depends on the token);
    // no-cache: the browser keeps it but must ask again every time.
    "Cache-Control": "private, no-cache",
    Vary: "Authorization, X-Extension-Token",
  };
  const sent = request.headers.get("if-none-match");
  if (sent && sent.split(",").some((tag) => tag.trim() === etag)) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders });
  }
  return new NextResponse(text, {
    status: 200,
    headers: { ...cacheHeaders, "Content-Type": "application/json" },
  });
}
