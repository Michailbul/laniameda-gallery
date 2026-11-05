"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, LayoutGrid, Loader2, Plus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { MOODBOARD_LIMITS } from "@/lib/moodboards";
import { RADIUS, display, mono, plural } from "./moodboards-view";

const errorText = (error: unknown, fallback: string) => {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /, "").split("\n")[0] : fallback;
};

const buttonBase = "inline-flex shrink-0 items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * The bar over the gallery while it is choosing images for a moodboard.
 * Everything under it is the normal gallery: collections, saved views, pills,
 * search and the liked filter all work; a click selects instead of opening.
 */
export function MoodboardPickBar({
  ownerUserId,
  boardId,
  boardName,
  selectedIds,
  onBoardCount,
  selectableCount,
  onSelectAllVisible,
  onClearSelection,
  onAdded,
  onCancel,
}: {
  ownerUserId: string;
  boardId: string;
  boardName: string;
  /** Selected pieces that are not on the board yet. */
  selectedIds: string[];
  /** How many of the board's images are in the gallery, or undefined while loading. */
  onBoardCount: number | undefined;
  /** Visible pieces that can still be added. */
  selectableCount: number;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const add = useMutation(api.moodboards.addMoodboardItems);
  const toast = useCoralToastSafe()?.toast;
  const [busy, setBusy] = useState(false);
  const count = selectedIds.length;

  const commit = async () => {
    if (busy || count === 0) return;
    setBusy(true);
    let added = 0;
    try {
      // The mutation takes a bounded batch; a long pick goes in order.
      for (let start = 0; start < selectedIds.length; start += MOODBOARD_LIMITS.itemsPerCall) {
        const result = await add({
          ownerUserId,
          moodboardId: boardId as Id<"moodboards">,
          assetIds: selectedIds.slice(start, start + MOODBOARD_LIMITS.itemsPerCall) as Id<"assets">[],
        });
        added += result.added.length;
      }
      toast?.(`Added ${plural(added, "image")} to ${boardName}`, added < count ? `${count - added} were already on it.` : undefined, "success", 3500);
      onAdded();
    } catch (err) {
      toast?.(added ? `Added ${plural(added, "image")}, then stopped` : "Could not add to the board", errorText(err, "Could not add the images."), "warning");
      if (added) onAdded();
    } finally {
      setBusy(false);
    }
  };

  return <div role="region" aria-label={`Adding to moodboard ${boardName}`}
    className="relative z-40 shrink-0 border-b-2 px-4 py-2.5 md:px-6"
    style={{ background: "var(--lm-surface-1)", borderColor: "var(--lm-ink)", boxShadow: "inset 3px 0 0 var(--lm-coral)", color: "var(--lm-text-primary)" }}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 xl:flex-nowrap">
      <div className="flex min-w-0 basis-full items-center gap-2.5 xl:basis-0 xl:flex-1">
        <span className="grid h-8 w-8 shrink-0 place-items-center" style={{ borderRadius: RADIUS, background: "var(--lm-coral)", color: "var(--lm-paper)" }}>
          <LayoutGrid size={15} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase leading-none tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
            Adding to{onBoardCount ? <span style={{ color: "var(--lm-text-ghost)" }}> · {onBoardCount} already on it</span> : null}
          </p>
          <p className="mt-1 truncate text-[15px] font-black uppercase leading-none tracking-tight md:text-base" style={display} title={boardName}>
            {boardName}
          </p>
        </div>
        <span aria-live="polite" className="ml-auto inline-flex shrink-0 items-center px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] xl:ml-1"
          style={{ ...mono, borderRadius: RADIUS, background: count ? "var(--lm-coral)" : "transparent", color: count ? "var(--lm-paper)" : "var(--lm-text-tertiary)", border: `1px solid ${count ? "var(--lm-coral)" : "var(--lm-border-strong)"}` }}>
          {count} selected
        </span>
      </div>

      <div className="flex w-full items-center gap-2 xl:w-auto">
        {selectableCount > count && <button type="button" onClick={onSelectAllVisible} disabled={busy} className={buttonBase}
          style={{ ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}
          title="Select every visible piece that is not on the board yet">
          <Check size={13} aria-hidden />All<span className="hidden sm:inline"> visible</span><span className="opacity-60">{selectableCount}</span>
        </button>}
        {count > 0 && <button type="button" onClick={onClearSelection} disabled={busy} className={buttonBase}
          style={{ ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}>
          Clear
        </button>}
        <button type="button" onClick={onCancel} disabled={busy} className={`${buttonBase} ml-auto xl:ml-0`} aria-label="Cancel and go back to the board"
          style={{ ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}>
          <X size={13} aria-hidden /><span className="hidden sm:inline">Cancel</span>
        </button>
        <button type="button" onClick={() => void commit()} disabled={busy || count === 0} className={buttonBase}
          style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-coral)", border: "1px solid var(--lm-coral)", color: "var(--lm-paper)" }}>
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={13} aria-hidden />}
          {count ? `Add ${count}` : "Add"}<span className="hidden sm:inline"> to board</span>
        </button>
      </div>
    </div>
  </div>;
}
