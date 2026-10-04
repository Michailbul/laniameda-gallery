import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { resolveUserIdCandidates } from "@/convex/authz";
import { getSessionSecret } from "@/lib/session-jwt";
import { getSessionUser } from "@/lib/telegram-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import type { PublicVideo } from "@/lib/youtube-page";

// The public YouTube page sits behind one shared password. The gate is enforced
// on the server: the videos are loaded here, only after the cookie checks out,
// and never ship to a browser that has not unlocked. Michael's own session
// skips the prompt.

export const YOUTUBE_COOKIE = "yt_access";
const YOUTUBE_ACCESS_MAX_AGE = 60 * 60 * 24 * 30;
const DEFAULT_PASSWORD = "ANDROMEDA";

const digest = (value: string) => createHash("sha256").update(value).digest();

export const checkYouTubePassword = (attempt: string) => {
  const expected = (process.env.YOUTUBE_PAGE_PASSWORD ?? DEFAULT_PASSWORD).trim().toLowerCase();
  return timingSafeEqual(digest(attempt.trim().toLowerCase()), digest(expected));
};

export const signYouTubeAccess = () =>
  new SignJWT({ scope: "youtube" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${YOUTUBE_ACCESS_MAX_AGE}s`)
    .sign(getSessionSecret());

export const youTubeCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: YOUTUBE_ACCESS_MAX_AGE,
});

export const ownerUserId = () => resolveUserIdCandidates(process.env.KB_OWNER_USER_ID ?? "")[0] ?? "";

const hasAccess = async () => {
  const jar = await cookies();
  const token = jar.get(YOUTUBE_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSessionSecret());
      if (payload.scope === "youtube") return true;
    } catch {
      // Expired or forged: fall through to the owner check.
    }
  }
  const user = await getSessionUser();
  return Boolean(user && resolveUserIdCandidates(process.env.KB_OWNER_USER_ID ?? "").includes(user.telegramId));
};

/** The videos, or null while the visitor has not unlocked the page. */
export async function loadYouTubeVideos(): Promise<PublicVideo[] | null> {
  if (!(await hasAccess())) return null;
  const owner = ownerUserId();
  if (!owner) return [];
  const rows = await getServerConvexClient(owner).query(api.videoRefs.listVideoRefs, {
    ownerUserId: owner,
    limit: 2000,
    sort: "views",
  });
  return rows.map((row) => ({
    externalId: row.externalId,
    url: row.url,
    title: row.title,
    channelName: row.channelName,
    channelHandle: row.channelHandle,
    channelUrl: row.channelUrl,
    subscribers: row.subscribers,
    medianViews: row.medianViews,
    views: row.views,
    publishedAt: row.publishedAt,
    durationSeconds: row.durationSeconds,
    isChannelBest: row.isChannelBest,
    topic: row.topic,
    styleFamily: row.styleFamily,
    styleDescription: row.styleDescription,
    format: row.format,
    whyItWorks: row.whyItWorks,
    hook: row.hook,
    titlePattern: row.titlePattern,
    thumbnailPattern: row.thumbnailPattern,
    audience: row.audience,
    productionStyle: row.productionStyle,
    language: row.language,
    channelLastUploadAt: row.channelLastUploadAt,
    checkedAt: row.checkedAt,
    collections: row.collections,
    tagNames: row.tagNames,
    thumbUrl: row.thumbUrl,
    frames: row.frames,
  }));
}
