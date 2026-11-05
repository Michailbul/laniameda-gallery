"use client";

import { useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { Eye, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionArgs } from "convex/server";
import {
  collectPrivateCount,
  describePrivateCount,
  publishInBatches,
  type PrivateCount,
  type PublishBatchResult,
} from "@/lib/publish-all";

export type PrivateCountArgs = Omit<FunctionArgs<typeof api.assets.countPrivateAssetsInView>, "cursor">;

export type PublishAllOutcome = PublishBatchResult & {
  requested: number;
  assetIds: string[];
  error?: string;
};

/**
 * PUBLISH ALL, behind a confirmation. Opening it asks the server how many
 * pieces of the current view are still private (the grid only knows what it
 * has loaded); the button then publishes exactly those ids, 200 at a time,
 * and reports how far it got.
 */
export function PublishAllDialog({
  open,
  onClose,
  viewLabel,
  filtered,
  countArgs,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  /** "DEAR ANNETE — ART DECO", "Everything" … */
  viewLabel: string;
  /** Chips, a media kind or Liked are narrowing the view. */
  filtered: boolean;
  countArgs: PrivateCountArgs | null;
  onPublished: (outcome: PublishAllOutcome) => void;
}) {
  const convex = useConvex();
  const [count, setCount] = useState<PrivateCount | null>(null);
  const [countState, setCountState] = useState<"counting" | "ready" | "failed">("counting");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Count on open and whenever the view's filters change under the dialog.
  const argsKey = JSON.stringify(countArgs);
  useEffect(() => {
    if (!open || !countArgs) return;
    let live = true;
    setCount(null);
    setCountState("counting");
    setError(null);
    collectPrivateCount((cursor) =>
      convex.query(api.assets.countPrivateAssetsInView, { ...countArgs, cursor: cursor ?? undefined }),
    )
      .then((result) => {
        if (!live) return;
        setCount(result);
        setCountState("ready");
      })
      .catch(() => {
        if (live) setCountState("failed");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- argsKey stands for countArgs
  }, [open, argsKey, convex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !progress) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, progress]);

  if (!open) return null;

  const copy = describePrivateCount(count, filtered ? `${viewLabel} with these filters` : viewLabel, countState);
  const busy = progress !== null;

  const publish = async () => {
    if (!count || !copy.publishable || busy) return;
    const ids = count.assetIds;
    setError(null);
    setProgress({ done: 0, total: ids.length });
    const result = await publishInBatches(
      ids,
      async (batch) => {
        const response = await fetch("/api/admin/assets/bulk-curation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetIds: batch, isPublic: true }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          result?: PublishBatchResult;
        } | null;
        if (!response.ok || !payload?.result) {
          throw new Error(payload?.error || "Bulk publish failed.");
        }
        return payload.result;
      },
      (done, total) => setProgress({ done, total }),
    );
    setProgress(null);
    if (result.error) {
      setError(`${result.updatedCount} made public, then: ${result.error}`);
      onPublished({ ...result, requested: ids.length, assetIds: ids.slice(0, result.failedAt ?? 0) });
      return;
    }
    onPublished({ ...result, requested: ids.length, assetIds: ids });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-all-title"
      style={{ fontFamily: "var(--lm-font)" }}
    >
      <div
        className="absolute inset-0 backdrop-blur-sm animate-fade-in"
        style={{ backgroundColor: "var(--lm-scrim)" }}
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        className="relative w-full rounded-t-3xl md:w-[460px] md:rounded-[24px] animate-sheet-slide-up"
        style={{
          background: "linear-gradient(180deg, var(--paper-muted) 0%, var(--paper) 100%)",
          border: "2px solid var(--lm-ink)",
          boxShadow: "var(--shadow-lg)",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <div
              style={{
                fontSize: "8px",
                fontWeight: 800,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--lm-text-ghost)",
              }}
            >
              Publish all · {viewLabel}
            </div>
            <h2
              id="publish-all-title"
              className="mt-1.5 flex items-center gap-2"
              style={{
                fontSize: "15px",
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--lm-text-primary)",
                margin: 0,
              }}
            >
              {countState === "counting" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {copy.headline}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p
          className="px-5 pt-3"
          style={{ fontSize: "12px", lineHeight: 1.55, color: "var(--lm-text-secondary)", margin: 0 }}
        >
          {copy.detail}
        </p>

        {progress ? (
          <div className="px-5 pt-4" role="status" aria-live="polite">
            <div
              className="flex items-center justify-between"
              style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--lm-text-secondary)" }}
            >
              <span>Publishing</span>
              <span className="tabular-nums">
                {progress.done.toLocaleString("en-US")} / {progress.total.toLocaleString("en-US")}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--lm-border)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                  background: "linear-gradient(90deg, var(--gradient-1), var(--gradient-3))",
                  transition: "width 160ms ease",
                }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="px-5 pt-3" style={{ fontSize: "11px", color: "var(--lm-coral)", margin: 0 }}>
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 px-5 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="lm-btn-ghost"
            style={{ border: "2px solid var(--lm-border-strong)", borderRadius: "12px", padding: "8px 14px", fontSize: "11px" }}
          >
            {copy.publishable ? "Keep private" : "Close"}
          </button>
          {copy.publishable ? (
            <button
              type="button"
              onClick={() => void publish()}
              disabled={busy}
              className="lm-btn-brutal inline-flex items-center gap-1.5"
              style={{ borderRadius: "12px", padding: "8px 14px", fontSize: "11px", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              Publish {count?.count.toLocaleString("en-US")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
