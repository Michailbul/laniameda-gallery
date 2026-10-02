// Client-side shape of a saved social post (convex bookmarkSummaryValidator)
// plus the formatting the post cards share.

export type BookmarkMedia = {
  kind: "image" | "video" | "gif";
  url: string;
  width?: number;
  height?: number;
  alt?: string;
};

export type BookmarkPost = {
  _id: string;
  platform: "x";
  externalId: string;
  url: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorVerified?: boolean;
  text?: string;
  lang?: string;
  postedAt?: number;
  media: BookmarkMedia[];
  quotedPost?: {
    url?: string;
    authorName?: string;
    authorHandle?: string;
    text?: string;
  };
  metrics?: {
    replies?: number;
    reposts?: number;
    likes?: number;
    bookmarks?: number;
    views?: number;
  };
  userNote?: string;
  savedAt: number;
};

// 999 → "999", 1_234 → "1.2K", 12_345 → "12K", 3_400_000 → "3.4M".
export const formatBookmarkCount = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const abs = Math.abs(value);
  const scaled = (divisor: number, suffix: string) => {
    const n = value / divisor;
    return `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}${suffix}`;
  };
  if (abs >= 1e9) return scaled(1e9, "B");
  if (abs >= 1e6) return scaled(1e6, "M");
  if (abs >= 1e3) return scaled(1e3, "K");
  return String(Math.round(value));
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Oct 1, 2026" — X's own absolute date style, stable across time zones that
// share the UTC date (good enough for a card).
export const formatBookmarkDate = (timestamp: number | undefined) => {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
};

export const bookmarkAuthorLabel = (post: Pick<BookmarkPost, "authorName" | "authorHandle">) =>
  post.authorName || (post.authorHandle ? `@${post.authorHandle}` : "X post");

export const bookmarkPlatformLabel = (platform: BookmarkPost["platform"]) =>
  platform === "x" ? "X" : platform;

// Grid layout for a post card. The tile is taller than its media by the
// header/text/footer chrome; text-only posts size by their text length.
export const bookmarkCardLayout = (args: {
  post: BookmarkPost;
  previewWidth?: number;
  previewHeight?: number;
}) => {
  const hasMedia = args.post.media.length > 0;
  const textLength = (args.post.text ?? "").length + (args.post.quotedPost?.text?.length ?? 0) / 2;
  if (hasMedia && args.previewWidth && args.previewHeight) {
    const mediaRatio = Math.min(Math.max(args.previewHeight / args.previewWidth, 0.5), 1.4);
    const textLines = Math.min(3, Math.ceil(textLength / 48));
    const chrome = 0.3 + textLines * 0.07;
    return { width: 1000, height: Math.round((mediaRatio + chrome) * 1000) };
  }
  const lines = Math.min(12, Math.max(2, Math.ceil(textLength / 40)));
  return { width: 1000, height: Math.round((0.32 + lines * 0.085) * 1000) };
};

const searchableText = (post: BookmarkPost) =>
  [
    post.authorName,
    post.authorHandle ? `@${post.authorHandle}` : undefined,
    post.authorHandle,
    post.text,
    post.quotedPost?.authorHandle,
    post.quotedPost?.text,
    post.userNote,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

// The bookmarks view's narrowing: entries filed in any of `folderIds` (null =
// everywhere) whose post matches every word of `query`.
export const filterBookmarkEntries = <
  T extends { bookmark?: BookmarkPost; folderIds?: string[] },
>(
  entries: T[],
  args: { folderIds: Set<string> | null; query: string },
) => {
  const words = args.query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (!entry.bookmark) return false;
    if (args.folderIds && !(entry.folderIds ?? []).some((id) => args.folderIds!.has(id))) {
      return false;
    }
    if (words.length === 0) return true;
    const haystack = searchableText(entry.bookmark);
    return words.every((word) => haystack.includes(word));
  });
};
