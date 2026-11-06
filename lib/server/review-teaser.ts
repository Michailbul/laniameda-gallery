import { cache as requestCache } from "react";
import sharp from "sharp";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { mintConvexActorToken, resolveConvexAuthPrivateKey } from "@/lib/convex-auth";

// The blurred preview behind the review sign-in: the real layout of the
// current round (folders, styles, frames) with every frame shrunk to a tiny
// blurred thumbnail here on the server. The page never receives a frame URL
// before sign-in, so nothing unreleased can be lifted from it. Cached per
// server instance for half an hour, per project and round.

export type ReviewTeaser = {
  title: string;
  subtitle?: string;
  round?: { label: string; title?: string; publishedAt?: number };
  folders: Array<{ section: "locations" | "characters" | "scenes"; area?: string; name: string; icon?: string; count: number }>;
  styles: Array<{ label: string; count: number }>;
  // Data URLs (about 48 px wide, already blurred) with the frame's real ratio.
  frames: Array<{ src: string; w: number; h: number; folder: string; style?: string }>;
};

const TTL_MS = 30 * 60 * 1000;
const THUMB_WIDTH = 48;
const FETCH_TIMEOUT_MS = 3000;
const cache = new Map<string, { at: number; value: ReviewTeaser }>();

const convexUrl = () => process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

const tinyBlur = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const input = Buffer.from(await response.arrayBuffer());
    const output = await sharp(input)
      .resize({ width: THUMB_WIDTH })
      .blur(1.2)
      .webp({ quality: 45 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The teaser's plain data (title, round, folders, styles, frame keys), read
 * once per request: the sign-in card needs the round right away, the blurred
 * backdrop (which also shrinks the frames) streams in after it.
 */
export const getReviewTeaserData = requestCache(async (slug: string) => {
  const privateKeyPem = resolveConvexAuthPrivateKey();
  const url = convexUrl();
  if (!privateKeyPem || !url) return null;
  const token = mintConvexActorToken(`teaser:${slug.trim().toLowerCase()}`, { privateKeyPem, ttlSeconds: 120 });
  return await fetchQuery(api.review.signInTeaser, { slug }, { url, token }).catch(() => null);
});

/** The signed-out preview for a review project, or null when there is none. */
export async function getReviewTeaser(slug: string): Promise<ReviewTeaser | null> {
  const data = await getReviewTeaserData(slug);
  if (!data) return null;

  const key = `${slug}:${data.round?.label ?? "none"}:${data.round?.publishedAt ?? 0}:${data.frames.length}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const frames: ReviewTeaser["frames"] = [];
  const queue = data.frames.map((frame, index) => ({ frame, index }));
  const results = new Array<string | null>(queue.length).fill(null);
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const src = next.frame.src.startsWith("http") ? next.frame.src : `${data.mediaBase}/${next.frame.src}`;
      results[next.index] = await tinyBlur(src);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  data.frames.forEach((frame, index) => {
    const src = results[index];
    if (src) frames.push({ src, w: frame.w, h: frame.h, folder: frame.folder, style: frame.style });
  });

  const value: ReviewTeaser = {
    title: data.title,
    subtitle: data.subtitle,
    round: data.round,
    folders: data.folders,
    styles: data.styles,
    frames,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
