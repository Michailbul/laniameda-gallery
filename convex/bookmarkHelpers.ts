// Pure helpers for saved social posts. No Convex imports, so the extension
// route, the save action and tests share one normalization.

const X_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
]);

// Handles are 1-15 word characters; status ids are numeric snowflakes.
const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:\/|$)/;
const WEB_STATUS_PATH = /^\/i\/web\/status\/(\d{5,25})(?:\/|$)/;

export type ParsedXPostUrl = {
  externalId: string;
  authorHandle?: string;
  url: string;
};

// Accepts any x.com / twitter.com permalink (with /photo/1, /analytics,
// query strings, …) and returns the post id plus the canonical permalink.
export const parseXPostUrl = (value: string | undefined | null): ParsedXPostUrl | null => {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!X_HOSTS.has(host)) return null;

  const status = STATUS_PATH.exec(parsed.pathname);
  if (status) {
    const [, handle, externalId] = status;
    if (handle.toLowerCase() === "i") {
      return { externalId, url: `https://x.com/i/web/status/${externalId}` };
    }
    return {
      externalId,
      authorHandle: handle,
      url: `https://x.com/${handle}/status/${externalId}`,
    };
  }
  const web = WEB_STATUS_PATH.exec(parsed.pathname);
  if (web) {
    const [, externalId] = web;
    return { externalId, url: `https://x.com/i/web/status/${externalId}` };
  }
  return null;
};

export const normalizeXHandle = (value: string | undefined | null) => {
  const handle = (value ?? "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : undefined;
};

export const clampText = (value: string | undefined | null, max: number) => {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
};

// Only http(s) media URLs from the page are kept; data: and blob: URLs
// can't be rendered later.
export const sanitizeHttpUrl = (value: string | undefined | null) => {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

// pbs.twimg.com serves sized variants via ?name=small|medium|large|orig.
// Ask for the original so the gallery keeps the full-resolution image.
export const toOriginalXImageUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hostname !== "pbs.twimg.com" || !url.pathname.startsWith("/media/")) {
      return value;
    }
    url.searchParams.set("name", "orig");
    return url.toString();
  } catch {
    return value;
  }
};

// Short single-line label for a post: used as the preview asset's file name
// and in search text.
export const buildXPostTitle = (args: {
  authorName?: string;
  authorHandle?: string;
  text?: string;
}) => {
  const who = args.authorHandle ? `@${args.authorHandle}` : args.authorName ?? "X post";
  const snippet = (args.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return snippet ? `${who}: ${snippet}` : who;
};

// Plain-text rendering of a post for the semantic search text lane.
export const buildBookmarkSearchText = (args: {
  authorName?: string;
  authorHandle?: string;
  text?: string;
  quotedPost?: { authorHandle?: string; text?: string };
  userNote?: string;
}) =>
  [
    args.authorName || args.authorHandle
      ? `post by ${[args.authorName, args.authorHandle ? `@${args.authorHandle}` : undefined]
          .filter(Boolean)
          .join(" ")} on X`
      : "post on X",
    args.text?.trim(),
    args.quotedPost?.text?.trim()
      ? `quoting ${args.quotedPost.authorHandle ? `@${args.quotedPost.authorHandle}: ` : ""}${args.quotedPost.text.trim()}`
      : undefined,
    args.userNote?.trim() ? `note: ${args.userNote.trim()}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");

// ── Reading a post without the page ────────────────────────────────────────
// Agents save a post from its link alone. Two public read-only endpoints
// return a post as JSON; these map each to the capture shape the extension
// sends, so one normalizer serves both paths.

export type FetchedXPost = {
  url: string;
  externalId?: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorVerified?: boolean;
  text?: string;
  lang?: string;
  postedAt?: number;
  media?: {
    kind: "image" | "video" | "gif";
    url: string;
    width?: number;
    height?: number;
    alt?: string;
  }[];
  quotedPost?: { url?: string; authorName?: string; authorHandle?: string; text?: string };
  metrics?: {
    replies?: number;
    reposts?: number;
    likes?: number;
    bookmarks?: number;
    views?: number;
  };
};

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const asString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

// X serves avatars as 48px `_normal`; the 400px variant shares the path.
export const toLargeXAvatarUrl = (value: string | undefined) =>
  value ? value.replace(/_normal(\.[a-z0-9]+)$/i, "_400x400$1") : undefined;

export const fxTwitterPostUrl = (externalId: string, handle?: string) =>
  `https://api.fxtwitter.com/${handle ?? "i"}/status/${externalId}`;

// The embed endpoint wants a token derived from the id (any value passes
// today; this is the one X's own embed script computes).
export const xSyndicationPostUrl = (externalId: string) => {
  const token = ((Number(externalId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  return `https://cdn.syndication.twimg.com/tweet-result?id=${externalId}&token=${token || "a"}`;
};

const fxMedia = (tweet: Json | undefined): NonNullable<FetchedXPost["media"]> =>
  asArray(asRecord(tweet?.media)?.all)
    .map((raw) => {
      const item = asRecord(raw);
      const type = asString(item?.type);
      if (!item || !type) return null;
      const isImage = type === "photo";
      // A video is kept as its poster frame (see bookmarkMediaValidator).
      const url = isImage ? asString(item.url) : asString(item.thumbnail_url);
      if (!url) return null;
      return {
        kind: isImage ? ("image" as const) : type === "gif" ? ("gif" as const) : ("video" as const),
        url,
        width: asNumber(item.width),
        height: asNumber(item.height),
        alt: asString(item.altText),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

// api.fxtwitter.com/<handle>/status/<id> → { code, tweet }.
export const xPostFromFxTwitter = (payload: unknown): FetchedXPost | null => {
  const tweet = asRecord(asRecord(payload)?.tweet);
  const externalId = asString(tweet?.id);
  if (!tweet || !externalId) return null;
  const author = asRecord(tweet.author);
  const authorHandle = asString(author?.screen_name);
  const quote = asRecord(tweet.quote);
  const quoteAuthor = asRecord(quote?.author);
  const ownMedia = fxMedia(tweet);
  const seconds = asNumber(tweet.created_timestamp);
  return {
    url: `https://x.com/${authorHandle ?? "i/web"}/status/${externalId}`,
    externalId,
    authorName: asString(author?.name),
    authorHandle,
    authorAvatarUrl: toLargeXAvatarUrl(asString(author?.avatar_url)),
    authorVerified:
      asRecord(author?.verification)?.verified === true ? true : undefined,
    text: asString(tweet.text),
    lang: asString(tweet.lang),
    postedAt: seconds ? seconds * 1000 : undefined,
    // A quote post's picture usually belongs to the quoted post.
    media: ownMedia.length > 0 ? ownMedia : fxMedia(quote),
    quotedPost: quote
      ? {
          url: asString(quote.url),
          authorName: asString(quoteAuthor?.name),
          authorHandle: asString(quoteAuthor?.screen_name),
          text: asString(quote.text),
        }
      : undefined,
    metrics: {
      replies: asNumber(tweet.replies),
      reposts: asNumber(tweet.retweets),
      likes: asNumber(tweet.likes),
      bookmarks: asNumber(tweet.bookmarks),
      views: asNumber(tweet.views),
    },
  };
};

const syndicationMedia = (tweet: Json | undefined): NonNullable<FetchedXPost["media"]> =>
  asArray(tweet?.mediaDetails)
    .map((raw) => {
      const item = asRecord(raw);
      const url = asString(item?.media_url_https);
      if (!item || !url) return null;
      const type = asString(item.type);
      const size = asRecord(item.original_info);
      return {
        kind:
          type === "photo"
            ? ("image" as const)
            : type === "animated_gif"
              ? ("gif" as const)
              : ("video" as const),
        url,
        width: asNumber(size?.width),
        height: asNumber(size?.height),
        alt: asString(item.ext_alt_text),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

// The text field ends with the t.co link of the attached media; the display
// range marks where the words stop.
const syndicationText = (tweet: Json | undefined) => {
  const text = typeof tweet?.text === "string" ? tweet.text : undefined;
  if (!text) return undefined;
  const range = asArray(tweet?.display_text_range);
  const end = asNumber(range[1]);
  const start = asNumber(range[0]) ?? 0;
  const shown = end ? Array.from(text).slice(start, end).join("") : text;
  return shown.trim() || undefined;
};

// cdn.syndication.twimg.com/tweet-result → the embed's own payload.
export const xPostFromSyndication = (payload: unknown): FetchedXPost | null => {
  const tweet = asRecord(payload);
  const externalId = asString(tweet?.id_str);
  if (!tweet || !externalId || tweet.__typename === "TweetTombstone") return null;
  const user = asRecord(tweet.user);
  const authorHandle = asString(user?.screen_name);
  const quote = asRecord(tweet.quoted_tweet);
  const quoteUser = asRecord(quote?.user);
  const quoteHandle = asString(quoteUser?.screen_name);
  const quoteId = asString(quote?.id_str);
  const ownMedia = syndicationMedia(tweet);
  const postedAt = Date.parse(asString(tweet.created_at) ?? "");
  return {
    url: `https://x.com/${authorHandle ?? "i/web"}/status/${externalId}`,
    externalId,
    authorName: asString(user?.name),
    authorHandle,
    authorAvatarUrl: toLargeXAvatarUrl(asString(user?.profile_image_url_https)),
    authorVerified:
      user?.is_blue_verified === true || user?.verified === true ? true : undefined,
    text: syndicationText(tweet),
    lang: asString(tweet.lang),
    postedAt: Number.isNaN(postedAt) ? undefined : postedAt,
    media: ownMedia.length > 0 ? ownMedia : syndicationMedia(quote),
    quotedPost: quote
      ? {
          url: quoteHandle && quoteId ? `https://x.com/${quoteHandle}/status/${quoteId}` : undefined,
          authorName: asString(quoteUser?.name),
          authorHandle: quoteHandle,
          text: syndicationText(quote),
        }
      : undefined,
    metrics: {
      replies: asNumber(tweet.conversation_count),
      likes: asNumber(tweet.favorite_count),
    },
  };
};

// Fields the caller supplied win over the fetched ones; an empty value never
// blanks a fetched field.
export const mergeXPostCapture = (
  fetched: FetchedXPost | null,
  supplied: Partial<FetchedXPost> | undefined,
  url: string,
): FetchedXPost => {
  const merged: Json = { ...(fetched ?? {}) };
  for (const [key, value] of Object.entries(supplied ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }
  return { ...(merged as FetchedXPost), url: fetched?.url ?? url };
};
