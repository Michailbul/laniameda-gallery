"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { ExternalLink } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  bookmarkPlatformLabel,
  formatBookmarkCount,
  formatBookmarkDate,
  type BookmarkPost,
} from "@/lib/bookmarks";
import {
  BookmarkAuthorRow,
  BookmarkQuotedPost,
} from "@/components/gallery/bookmark-post-card";

const labelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  color: "var(--lm-text-ghost)",
  textTransform: "uppercase",
};

const bodyStyle: React.CSSProperties = {
  fontFamily: "var(--lm-font)",
  fontSize: "12.5px",
  lineHeight: 1.55,
  color: "var(--lm-text-secondary)",
  wordBreak: "break-word",
};

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span style={labelStyle}>{label}</span>
      <span className="text-right tabular-nums" style={{ ...bodyStyle, fontSize: "11.5px" }}>
        {value}
      </span>
    </div>
  );
}

// The saved post in the detail panel: the post as captured (author, text,
// quoted post, media, counts, permalink) plus the owner's own note.
export function BookmarkDetail({
  post,
  ownerUserId,
  canEdit,
}: {
  post: BookmarkPost;
  ownerUserId?: string;
  canEdit: boolean;
}) {
  const updateNote = useMutation(api.bookmarks.updateBookmarkNote);
  const [note, setNote] = useState(post.userNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNote(post.userNote ?? "");
  }, [post._id, post.userNote]);
  const dirty = note.trim() !== (post.userNote ?? "").trim();

  const saveNote = async () => {
    if (!ownerUserId || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await updateNote({
        ownerUserId,
        bookmarkId: post._id as Id<"bookmarks">,
        userNote: note.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  };

  const platform = bookmarkPlatformLabel(post.platform);
  return (
    <div className="flex flex-col gap-3 pb-3">
      <div className="flex items-center justify-between gap-2">
        <span style={labelStyle}>{platform} post</span>
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1"
          style={{ fontSize: "11px", fontWeight: 600, color: "var(--lm-coral)" }}
        >
          Open on {platform}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <BookmarkAuthorRow post={post} />

      {post.text ? (
        <p className="whitespace-pre-line" style={{ ...bodyStyle, color: "var(--lm-text-primary)" }} lang={post.lang}>
          {post.text}
        </p>
      ) : null}

      {post.quotedPost ? <BookmarkQuotedPost quoted={post.quotedPost} /> : null}

      {post.media.length > 1 ? (
        <div className="grid grid-cols-2 gap-1.5">
          {post.media.map((media) => (
            <a
              key={media.url}
              href={media.url}
              target="_blank"
              rel="noopener noreferrer"
              className="relative block aspect-square overflow-hidden rounded-md"
              style={{ background: "var(--lm-surface-2)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote X media */}
              <img
                src={media.url}
                alt={media.alt ?? ""}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col">
        <Row label="Posted" value={formatBookmarkDate(post.postedAt)} />
        <Row label="Saved" value={formatBookmarkDate(post.savedAt)} />
        <Row label="Replies" value={formatBookmarkCount(post.metrics?.replies)} />
        <Row label="Reposts" value={formatBookmarkCount(post.metrics?.reposts)} />
        <Row label="Likes" value={formatBookmarkCount(post.metrics?.likes)} />
        <Row label="Bookmarks" value={formatBookmarkCount(post.metrics?.bookmarks)} />
        <Row label="Views" value={formatBookmarkCount(post.metrics?.views)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span style={labelStyle}>Note</span>
        {canEdit ? (
          <>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Why you saved this…"
              className="w-full resize-y rounded-md px-2 py-1.5 outline-none"
              style={{
                ...bodyStyle,
                background: "var(--lm-surface-0)",
                border: "1px solid var(--lm-border-subtle)",
              }}
            />
            {dirty || error ? (
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontSize: "11px", color: "var(--lm-status-error-text)" }}>
                  {error ?? ""}
                </span>
                <button
                  type="button"
                  onClick={() => void saveNote()}
                  disabled={saving || !dirty}
                  className="rounded-md px-2.5 py-1"
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    background: "var(--lm-ink)",
                    color: "var(--lm-paper)",
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? "Saving…" : "Save note"}
                </button>
              </div>
            ) : null}
          </>
        ) : post.userNote ? (
          <p style={bodyStyle}>{post.userNote}</p>
        ) : (
          <p style={{ ...bodyStyle, color: "var(--lm-text-ghost)" }}>No note.</p>
        )}
      </div>
    </div>
  );
}
