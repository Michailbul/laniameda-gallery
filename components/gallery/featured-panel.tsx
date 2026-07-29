"use client";

/* eslint-disable @next/next/no-img-element -- row thumbs are tiny R2 images;
   next/image adds wrapper overhead and bypasses its optimizer for R2 anyway. */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, Star, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** Must match convex/showcase.ts FEATURED_REEL_LIMIT. */
const PUBLIC_REEL_CAP = 12;

/**
 * The featured shelf — the owner's control over what leads the public home, in
 * the exact order the page will show it.
 *
 * Flat and boxless: rows on hairlines, the order carried by a number rather
 * than a card. The cut line is the one piece of chrome, because "featured but
 * not actually out front" is invisible everywhere else.
 */
export function FeaturedPanel({
  ownerUserId,
  open,
  onClose,
  onOpenAsset,
}: {
  ownerUserId: string;
  open: boolean;
  onClose: () => void;
  /** Jump to the asset in the grid (closes the panel). */
  onOpenAsset?: (assetId: string) => void;
}) {
  const rows = useQuery(
    api.assets.listFeaturedAssets,
    open ? { ownerUserId, publicCap: PUBLIC_REEL_CAP } : "skip",
  );
  const reorder = useMutation(api.assets.reorderFeaturedAssets);
  const setDescription = useMutation(api.assets.setAssetDescription);
  const setStarred = useMutation(api.assets.setAssetStarred);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !draft) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, draft]);

  const run = useCallback(async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }, []);

  // Reorder writes the WHOLE order, so a nudge can't drift out of sync with
  // the sort the public page runs.
  const move = useCallback(
    (index: number, delta: number) => {
      if (!rows) return;
      const next = index + delta;
      if (next < 0 || next >= rows.length) return;
      const ids = rows.map((row) => row.asset._id as Id<"assets">);
      [ids[index], ids[next]] = [ids[next], ids[index]];
      void run(() => reorder({ ownerUserId, assetIds: ids }));
    },
    [rows, reorder, ownerUserId, run],
  );

  const unfeature = useCallback(
    async (assetId: string, isPublic: boolean) => {
      // isFeatured lives behind the curator secret, so it goes through the
      // server route rather than straight to Convex.
      await run(async () => {
        const res = await fetch(`/api/admin/assets/${assetId}/curation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Keep it published — unfeaturing is not unpublishing.
          body: JSON.stringify({ isPublic, isFeatured: false }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
      });
    },
    [run],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Featured shelf"
      className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[560px] flex-col"
      style={{
        background: "var(--lm-surface-1)",
        borderLeft: "1px solid var(--lm-border-strong)",
        fontFamily: "var(--lm-font)",
        boxShadow: "-24px 0 60px rgba(0,0,0,0.28)",
      }}
    >
      <header
        className="flex items-baseline justify-between px-5 pb-3 pt-4"
        style={{ borderBottom: "1px solid var(--lm-border-subtle)" }}
      >
        <div>
          <h2
            style={{
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--lm-text-primary)",
            }}
          >
            Featured
          </h2>
          <p style={{ fontSize: "11.5px", color: "var(--lm-text-tertiary)" }}>
            {rows === undefined
              ? "Loading…"
              : `${rows.length} featured · top ${PUBLIC_REEL_CAP} lead the public home`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close featured shelf"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--lm-text-secondary)",
            fontSize: 20,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
      </header>

      {error && (
        <p
          className="px-5 py-2"
          style={{ fontSize: "11.5px", color: "var(--lm-coral)" }}
        >
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        {rows === undefined ? (
          <p style={noteStyle} className="px-5 py-6">
            Loading the shelf…
          </p>
        ) : rows.length === 0 ? (
          <p style={noteStyle} className="px-5 py-6">
            Nothing is featured yet. Star-worthy pieces get here by being
            published and marked featured from a card.
          </p>
        ) : (
          rows.map((row, index) => {
            const asset = row.asset;
            const id = asset._id as string;
            const thumb = asset.thumbUrl ?? asset.url;
            const editing = draft?.id === id;
            // The row where the public reel stops carrying pieces.
            const cutHere =
              index === PUBLIC_REEL_CAP && rows.length > PUBLIC_REEL_CAP;
            return (
              <div key={id}>
                {cutHere && (
                  <p
                    className="px-5 pb-2 pt-4"
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--lm-coral)",
                      borderTop: "1px solid var(--lm-coral)",
                    }}
                  >
                    Below the cut — featured, but not on the home
                  </p>
                )}
                <div
                  className="flex items-start gap-3 px-5 py-3"
                  style={{
                    borderBottom: "1px solid var(--lm-border-subtle)",
                    opacity: row.onPublicHome ? 1 : 0.55,
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--lm-text-ghost)",
                      width: 18,
                      paddingTop: 14,
                    }}
                  >
                    {row.position}
                  </span>

                  <button
                    type="button"
                    onClick={() => onOpenAsset?.(id)}
                    title="Show this in the gallery"
                    className="shrink-0 cursor-pointer border-none bg-transparent p-0"
                    style={{
                      width: 82,
                      height: 52,
                      borderRadius: 6,
                      overflow: "hidden",
                      background: "var(--lm-surface-2)",
                    }}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate"
                      style={{
                        fontSize: "12px",
                        fontWeight: 550,
                        color: "var(--lm-text-primary)",
                      }}
                    >
                      {asset.fileName ?? "Untitled"}
                    </p>

                    {editing ? (
                      <textarea
                        autoFocus
                        rows={2}
                        value={draft.text}
                        onChange={(event) =>
                          setDraft({ id, text: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setDraft(null);
                          } else if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            (event.target as HTMLTextAreaElement).blur();
                          }
                        }}
                        onBlur={() => {
                          const text = draft.text;
                          setDraft(null);
                          if ((asset.description ?? "") === text.trim()) return;
                          void run(() =>
                            setDescription({
                              ownerUserId,
                              assetId: id as Id<"assets">,
                              description: text,
                            }),
                          );
                        }}
                        placeholder="Describe this piece…"
                        className="mt-1 w-full resize-none bg-transparent outline-none"
                        style={{
                          fontSize: "11.5px",
                          lineHeight: 1.45,
                          color: "var(--lm-text-primary)",
                          borderBottom: "1px solid var(--lm-coral)",
                          caretColor: "var(--lm-coral)",
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ id, text: asset.description ?? "" })
                        }
                        title="Edit the description"
                        className="mt-0.5 block w-full cursor-text border-none bg-transparent p-0 text-left"
                        style={{
                          fontSize: "11.5px",
                          lineHeight: 1.45,
                          color: asset.description
                            ? "var(--lm-text-secondary)"
                            : "var(--lm-text-ghost)",
                        }}
                      >
                        {asset.description || "Add a description…"}
                      </button>
                    )}
                  </div>

                  <span className="flex shrink-0 items-center gap-0.5 pt-2">
                    <IconButton
                      label="Move up"
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label="Move down"
                      disabled={busy || index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label={
                        asset.starredAt ? "Remove highlight" : "Highlight"
                      }
                      active={Boolean(asset.starredAt)}
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          setStarred({
                            ownerUserId,
                            assetId: id as Id<"assets">,
                            starred: !asset.starredAt,
                          }),
                        )
                      }
                    >
                      <Star
                        className="h-3.5 w-3.5"
                        fill={asset.starredAt ? "currentColor" : "none"}
                      />
                    </IconButton>
                    <IconButton
                      label="Remove from featured"
                      disabled={busy}
                      onClick={() =>
                        void unfeature(id, asset.isPublic === true)
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </IconButton>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 items-center justify-center border-none bg-transparent"
      style={{
        cursor: disabled ? "default" : "pointer",
        color: active ? "var(--lm-coral)" : "var(--lm-text-tertiary)",
        opacity: disabled ? 0.3 : 1,
        transition: "color var(--lm-duration-fast)",
      }}
    >
      {children}
    </button>
  );
}

const noteStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--lm-text-tertiary)",
};
