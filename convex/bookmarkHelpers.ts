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
