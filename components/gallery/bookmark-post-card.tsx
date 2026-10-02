"use client";

import { memo, useState } from "react";
import { BadgeCheck, Heart, MessageCircle, Repeat2 } from "lucide-react";
import {
  bookmarkAuthorLabel,
  formatBookmarkCount,
  formatBookmarkDate,
  type BookmarkPost,
} from "@/lib/bookmarks";

// The X glyph, drawn inline so the card needs no brand asset.
export function XGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.33l4.38 5.79L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z" />
    </svg>
  );
}

export function BookmarkAvatar({ post, size = 28 }: { post: BookmarkPost; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (post.authorName || post.authorHandle || "X").trim().charAt(0).toUpperCase();
  if (post.authorAvatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatar, no optimizer
      <img
        src={post.authorAvatarUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{
        width: size,
        height: size,
        background: "color-mix(in srgb, var(--text-primary) 10%, var(--surface-1))",
        color: "var(--text-primary)",
      }}
    >
      {initial}
    </span>
  );
}

export function BookmarkAuthorRow({ post, compact = false }: { post: BookmarkPost; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <BookmarkAvatar post={post} size={compact ? 24 : 32} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1">
          <span
            className="truncate text-[13px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {bookmarkAuthorLabel(post)}
          </span>
          {post.authorVerified ? (
            <BadgeCheck className="h-3.5 w-3.5 shrink-0" style={{ color: "#1d9bf0" }} />
          ) : null}
        </span>
        {post.authorHandle && post.authorName ? (
          <span className="truncate text-[11px]" style={{ color: "var(--text-ghost)" }}>
            @{post.authorHandle}
          </span>
        ) : null}
      </div>
      <XGlyph className="h-3.5 w-3.5 shrink-0 opacity-70" />
    </div>
  );
}

export function BookmarkMetricsRow({ post }: { post: BookmarkPost }) {
  const date = formatBookmarkDate(post.postedAt);
  const replies = formatBookmarkCount(post.metrics?.replies);
  const reposts = formatBookmarkCount(post.metrics?.reposts);
  const likes = formatBookmarkCount(post.metrics?.likes);
  return (
    <div
      className="flex min-w-0 items-center gap-3 text-[11px] tabular-nums"
      style={{ color: "var(--text-ghost)" }}
    >
      {date ? <span className="truncate">{date}</span> : null}
      <span className="ml-auto flex items-center gap-3">
        {replies ? (
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3" />
            {replies}
          </span>
        ) : null}
        {reposts ? (
          <span className="flex items-center gap-1">
            <Repeat2 className="h-3 w-3" />
            {reposts}
          </span>
        ) : null}
        {likes ? (
          <span className="flex items-center gap-1">
            <Heart className="h-3 w-3" />
            {likes}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function BookmarkQuotedPost({ quoted }: { quoted: NonNullable<BookmarkPost["quotedPost"]> }) {
  return (
    <div
      className="rounded-lg px-2.5 py-2 text-[12px] leading-snug"
      style={{
        border: "1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)",
        color: "var(--text-primary)",
      }}
    >
      {quoted.authorHandle || quoted.authorName ? (
        <div className="mb-0.5 truncate text-[11px] font-semibold">
          {quoted.authorName ?? ""}
          {quoted.authorHandle ? (
            <span style={{ color: "var(--text-ghost)" }}> @{quoted.authorHandle}</span>
          ) : null}
        </div>
      ) : null}
      {quoted.text ? <p className="line-clamp-3 whitespace-pre-line">{quoted.text}</p> : null}
    </div>
  );
}

type BookmarkPostCardProps = {
  post: BookmarkPost;
  /** The preview asset's thumbnail: the post's first photo/poster. */
  mediaSrc?: string;
  collectionLabels?: string[];
  starred?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  checked?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
};

// A saved X post as a gallery tile: author, text, media, date and counts,
// instead of a bare image. Fills whatever slot the grid gives it.
export const BookmarkPostCard = memo(function BookmarkPostCard({
  post,
  mediaSrc,
  collectionLabels,
  starred = false,
  selected = false,
  dimmed = false,
  checked = false,
  onClick,
}: BookmarkPostCardProps) {
  const hasMedia = post.media.length > 0 && Boolean(mediaSrc);
  const extraMedia = post.media.length > 1 ? post.media.length - 1 : 0;
  const classes = [
    "group relative flex h-full w-full cursor-pointer flex-col gap-2 overflow-hidden card-base rounded-xl p-3",
    starred && "card-starred",
    selected && "card-selected",
    dimmed && "card-dimmed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`X post by ${bookmarkAuthorLabel(post)}`}
      data-bookmark-card=""
      style={{
        background: "var(--surface-1)",
        outline: checked ? "2px solid var(--lm-accent)" : undefined,
        outlineOffset: checked ? -2 : undefined,
      }}
    >
      <BookmarkAuthorRow post={post} compact />

      {post.text ? (
        <p
          className={`min-h-0 whitespace-pre-line text-[13px] leading-snug ${
            hasMedia ? "line-clamp-3 shrink-0" : "flex-1 overflow-hidden"
          }`}
          style={{
            color: "var(--text-primary)",
            ...(hasMedia
              ? {}
              : {
                  maskImage: "linear-gradient(to bottom, black 80%, transparent)",
                  WebkitMaskImage: "linear-gradient(to bottom, black 80%, transparent)",
                }),
          }}
          lang={post.lang}
        >
          {post.text}
        </p>
      ) : null}

      {hasMedia ? (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumb, already sized */}
          <img
            src={mediaSrc}
            alt={post.media[0]?.alt ?? ""}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {post.media[0]?.kind !== "image" ? (
            <span className="absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              {post.media[0]?.kind === "gif" ? "GIF" : "Video"}
            </span>
          ) : null}
          {extraMedia > 0 ? (
            <span className="absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              +{extraMedia}
            </span>
          ) : null}
        </div>
      ) : null}

      {!hasMedia && post.quotedPost ? <BookmarkQuotedPost quoted={post.quotedPost} /> : null}

      {post.userNote ? (
        <p
          className="line-clamp-2 shrink-0 rounded-md px-2 py-1 text-[11px] italic"
          style={{
            background: "color-mix(in srgb, var(--lm-coral) 10%, transparent)",
            color: "var(--text-primary)",
          }}
        >
          {post.userNote}
        </p>
      ) : null}

      <div className="shrink-0">
        <BookmarkMetricsRow post={post} />
      </div>

      {collectionLabels && collectionLabels.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-1">
          {collectionLabels.slice(0, 2).map((label) => (
            <span
              key={label}
              className="max-w-[10rem] truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: "color-mix(in srgb, var(--text-primary) 7%, transparent)",
                color: "var(--text-primary)",
              }}
            >
              {label}
            </span>
          ))}
          {collectionLabels.length > 2 ? (
            <span className="text-[10px]" style={{ color: "var(--text-ghost)" }}>
              +{collectionLabels.length - 2}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
