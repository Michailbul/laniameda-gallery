"use client";

import { Component, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const labelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  color: "var(--lm-text-ghost)",
  textTransform: "uppercase",
};

const bodyStyle: React.CSSProperties = {
  fontSize: "12.5px",
  lineHeight: 1.55,
  color: "var(--lm-text-secondary)",
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
};

const when = (time: number) => {
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
};

/**
 * The comment thread on one asset: Michael's notes and agents' replies,
 * oldest first, with a box to add one (Enter sends, Shift+Enter breaks the
 * line). Agents read the thread with the asset (get_gallery_item) and through
 * list_asset_comments.
 */
function AssetCommentsThread({
  assetId,
  ownerUserId,
}: {
  assetId: string;
  ownerUserId: string;
}) {
  const comments = useQuery(api.assetComments.listAssetComments, {
    ownerUserId,
    assetId: assetId as Id<"assets">,
  });
  const addComment = useMutation(api.assetComments.addAssetComment);
  const deleteComment = useMutation(api.assetComments.deleteAssetComment);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await addComment({ ownerUserId, assetId: assetId as Id<"assets">, body });
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save the comment");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pb-3 pt-2.5" aria-label="Comments">
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <span style={labelStyle}>
          Comments{comments && comments.length > 0 ? ` · ${comments.length}` : ""}
        </span>
        {comments === undefined && (
          <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--lm-text-ghost)" }} />
        )}
      </div>
      {comments && comments.length > 0 && (
        <ol className="m-0 mb-2 flex list-none flex-col gap-2 p-0">
          {comments.map((comment) => (
            <li
              key={comment._id}
              className="group/comment relative pl-2.5"
              style={{
                borderLeft: `2px solid ${comment.author === "agent" ? "var(--lm-border-strong)" : "var(--lm-coral)"}`,
              }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="font-mono"
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: comment.author === "agent" ? "var(--lm-text-tertiary)" : "var(--lm-coral)",
                  }}
                >
                  {comment.author === "agent" ? "Agent" : "You"}
                </span>
                <span className="font-mono" style={{ fontSize: "9px", color: "var(--lm-text-ghost)" }}>
                  {when(comment.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => void deleteComment({ ownerUserId, commentId: comment._id })}
                  className="ml-auto border-none bg-transparent p-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-visible:opacity-100"
                  style={{ color: "var(--lm-text-ghost)", cursor: "pointer" }}
                  aria-label="Delete comment"
                  title="Delete comment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <p className="m-0" style={bodyStyle}>{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      <textarea
        rows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        placeholder="Leave a comment…"
        aria-label="New comment"
        disabled={sending}
        className="w-full resize-y bg-transparent outline-none"
        style={{
          ...bodyStyle,
          color: "var(--lm-text-primary)",
          border: "1px solid var(--lm-border)",
          borderRadius: "8px",
          padding: "6px 8px",
          caretColor: "var(--lm-coral)",
        }}
      />
      <div className="flex items-center justify-between gap-2 pt-1">
        <span style={{ fontSize: "10.5px", color: error ? "var(--lm-coral)" : "var(--lm-text-ghost)" }}>
          {error ?? "Enter to send · Shift+Enter for a new line"}
        </span>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          className="inline-flex items-center gap-1.5 border-none bg-transparent p-0"
          style={{
            ...labelStyle,
            fontWeight: 750,
            color: draft.trim() ? "var(--lm-coral)" : "var(--lm-text-ghost)",
            cursor: draft.trim() && !sending ? "pointer" : "default",
          }}
        >
          {sending && <Loader2 className="h-3 w-3 animate-spin" />}
          Comment
        </button>
      </div>
    </div>
  );
}

// Until the backend with comments is published, the query throws; the
// section then stays out of the panel instead of breaking it.
class CommentsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function AssetComments({ assetId, ownerUserId }: { assetId: string; ownerUserId: string }) {
  return (
    <CommentsBoundary key={assetId}>
      <AssetCommentsThread assetId={assetId} ownerUserId={ownerUserId} />
    </CommentsBoundary>
  );
}
