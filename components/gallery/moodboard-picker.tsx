"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, LayoutGrid, Loader2, Plus, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { MOODBOARD_LIMITS } from "@/lib/moodboards";

type Row = FunctionReturnType<typeof api.moodboards.listMoodboards>[number];

export type MoodboardPickerCollection = {
  _id: string;
  name: string;
  parentFolderId?: string;
  kind?: "storybook";
};

const mono: CSSProperties = { fontFamily: "var(--lm-font)" };
const RADIUS = "var(--lm-radius)";
const WIDTH = 320;
const MAX_HEIGHT = 440;

const errorText = (error: unknown, fallback: string) => {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /, "").split("\n")[0] : fallback;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * "Add to moodboard…" for one card or a selection: boards of the collection
 * being browsed first, then every other board, with search. One asset shows
 * ticks where it already sits, and a ticked row takes it off again. A new
 * board can be made inline and receives the assets at once.
 */
export function MoodboardPicker({ ownerUserId, assetIds, anchor, currentFolderId, collections, onClose }: {
  ownerUserId: string;
  assetIds: string[];
  /** The control that opened the picker; the panel sits beside it. */
  anchor: DOMRect | null;
  /** The collection being browsed, if any. Its boards (and its children's) lead. */
  currentFolderId?: string | null;
  /** Plain collections a new board may belong to. */
  collections: MoodboardPickerCollection[];
  onClose: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const single = assetIds.length === 1 ? (assetIds[0] as Id<"assets">) : null;
  const boards = useQuery(api.moodboards.listMoodboards, isAuthenticated ? { ownerUserId, previewLimit: 1 } : "skip");
  const memberships = useQuery(api.moodboards.listMoodboardsForAsset, isAuthenticated && single ? { ownerUserId, assetId: single } : "skip");
  const add = useMutation(api.moodboards.addMoodboardItems);
  const remove = useMutation(api.moodboards.removeMoodboardItems);
  const create = useMutation(api.moodboards.createMoodboard);
  const toast = useCoralToastSafe()?.toast;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const plainCollections = useMemo(() => collections.filter((entry) => entry.kind === undefined), [collections]);
  const current = plainCollections.find((entry) => entry._id === currentFolderId);
  const [ownerFolderId, setOwnerFolderId] = useState<string>(current?._id ?? plainCollections.find((entry) => !entry.parentFolderId)?._id ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    // The control that opened the picker toggles it itself.
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (panelRef.current?.contains(target) || target?.closest?.("[data-moodboard-picker-trigger]")) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onPointer, true); document.removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  const onBoard = useMemo(() => new Set((memberships ?? []).map((entry) => entry.moodboardId as string)), [memberships]);
  const nameOf = useMemo(() => new Map(collections.map((entry) => [entry._id, entry.name])), [collections]);
  const { here, elsewhere } = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (boards ?? []).filter((row) => terms.every((term) =>
      [row.name, row.folderName, row.mjCode, row.styleTag].some((value) => value?.toLowerCase().includes(term))));
    const inScope = (row: Row) => Boolean(currentFolderId) && (row.folderId === currentFolderId || row.parentFolderId === currentFolderId);
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return { here: matches.filter(inScope).sort(byName), elsewhere: matches.filter((row) => !inScope(row)) };
  }, [boards, search, currentFolderId]);

  const style = useMemo<CSSProperties>(() => {
    if (typeof window === "undefined" || !anchor) return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - WIDTH - 8));
    const below = anchor.bottom + 6;
    const top = below + MAX_HEIGHT > window.innerHeight - 8 ? Math.max(8, anchor.top - 6 - MAX_HEIGHT) : below;
    return { left, top };
  }, [anchor]);

  const subject = single ? "the image" : plural(assetIds.length, "image");
  // A large selection goes in batches of the per-call limit, in order.
  const addAll = async (moodboardId: Id<"moodboards">) => {
    const total = { added: 0, skipped: 0 };
    for (let start = 0; start < assetIds.length; start += MOODBOARD_LIMITS.itemsPerCall) {
      const result = await add({ ownerUserId, moodboardId, assetIds: assetIds.slice(start, start + MOODBOARD_LIMITS.itemsPerCall) as Id<"assets">[] });
      total.added += result.added.length;
      total.skipped += result.skipped.length;
    }
    return total;
  };
  const toggle = async (row: Row) => {
    if (busy) return;
    setBusy(row._id); setError("");
    try {
      if (single && onBoard.has(row._id)) {
        await remove({ ownerUserId, moodboardId: row._id, assetIds: [single] });
        toast?.(`Removed from ${row.name}`, undefined, "default", 2500);
        return;
      }
      const result = await addAll(row._id);
      toast?.(
        result.added ? `Added to ${row.name}` : `Already on ${row.name}`,
        [result.added > 1 ? plural(result.added, "image") : undefined, result.skipped && result.added ? `${result.skipped} already on it` : undefined]
          .filter(Boolean).join(" · ") || undefined,
        result.added ? "success" : "default", 3000,
      );
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not update the moodboard."));
    } finally { setBusy(null); }
  };

  const submitNew = async () => {
    const name = draft.trim();
    if (!name || !ownerFolderId || busy) return;
    setBusy("new"); setError("");
    try {
      const created = await create({ ownerUserId, folderId: ownerFolderId as Id<"folders">, name });
      const result = await addAll(created.moodboardId);
      toast?.(created.created ? `Created ${name}` : `Added to ${name}`, `${plural(result.added, "image")} on the board.`, "success", 3000);
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not create the moodboard."));
    } finally { setBusy(null); }
  };

  const renderRow = (row: Row) => {
    const member = single ? onBoard.has(row._id) : false;
    const preview = row.previewItems[0];
    return <button key={row._id} type="button" role="menuitemcheckbox" aria-checked={member} disabled={Boolean(busy)} onClick={() => void toggle(row)}
      title={member ? `Remove from ${row.name}` : `Add ${subject} to ${row.name}`}
      className="group/row grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--lm-surface-2)] disabled:cursor-wait">
      <span className="relative h-8 w-8 overflow-hidden" style={{ borderRadius: RADIUS, background: "var(--lm-surface-3)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- saved gallery thumbnails */}
        {preview?.thumbUrl ? <img src={preview.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <LayoutGrid size={13} className="absolute inset-0 m-auto" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-semibold" style={{ color: "var(--lm-text-primary)" }}>{row.name}</span>
        <span className="block truncate text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>
          {plural(row.itemCount, "image")}
          {/* Codes are case-sensitive; the label around them is not. */}
          {row.mjCode && <> · <span style={{ textTransform: "none", color: "var(--lm-text-tertiary)" }}>{row.mjCode}</span></>}
          {row.folderId !== currentFolderId && <> · {row.parentFolderId && row.parentFolderId !== currentFolderId ? `${nameOf.get(row.parentFolderId) ?? ""} / ${row.folderName}` : row.folderName}</>}
        </span>
      </span>
      <span className="grid h-4 w-4 place-items-center">
        {busy === row._id ? <Loader2 size={13} className="animate-spin" style={{ color: "var(--lm-text-tertiary)" }} aria-hidden />
          : member ? <>
            <Check size={14} className="group-hover/row:hidden" style={{ color: "var(--lm-coral)" }} aria-hidden />
            <X size={14} className="hidden group-hover/row:block" style={{ color: "var(--lm-text-primary)" }} aria-hidden />
          </>
          : <Plus size={13} className="opacity-0 transition-opacity group-hover/row:opacity-100" style={{ color: "var(--lm-text-tertiary)" }} aria-hidden />}
      </span>
    </button>;
  };

  const heading = (label: string, count: number) => <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
    <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{label}</span>
    <span className="text-[9px] font-bold tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>{count}</span>
  </div>;

  if (typeof document === "undefined") return null;
  return createPortal(<div ref={panelRef} role="menu" aria-label="Add to moodboard"
    onClick={(event) => event.stopPropagation()} className="fixed z-[90] flex flex-col"
    style={{
      ...style, width: WIDTH, maxWidth: "calc(100vw - 16px)", maxHeight: MAX_HEIGHT, ...mono,
      background: "var(--lm-surface-1)", border: "1px solid var(--lm-border-strong)", borderRadius: RADIUS,
      boxShadow: "var(--lm-modal-shadow)", overflow: "hidden",
    }}>
    <div className="flex items-center justify-between gap-2 border-b px-3 pb-2 pt-2.5" style={{ borderColor: "var(--lm-border-strong)" }}>
      <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--lm-text-tertiary)" }}>
        Add {single ? "to moodboard" : `${plural(assetIds.length, "image")} to a moodboard`}
      </span>
      <button type="button" onClick={onClose} aria-label="Close" className="grid h-5 w-5 place-items-center" style={{ color: "var(--lm-text-ghost)", borderRadius: RADIUS }}><X size={13} /></button>
    </div>
    <label className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--lm-border)" }}>
      <Search size={13} style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
      <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a board, code or style"
        aria-label="Search moodboards" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" style={{ color: "var(--lm-text-primary)", fontFamily: "var(--lm-font-display)" }} />
    </label>
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      {boards === undefined ? <p role="status" className="px-3 py-3 text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--lm-text-ghost)" }}>Loading boards…</p>
        : here.length + elsewhere.length === 0 ? <p className="px-3 py-3 text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)", fontFamily: "var(--lm-font-display)" }}>
          {search ? "No board matches." : "No moodboards yet. Make the first one below."}
        </p>
        : <>
          {here.length > 0 && <>{heading(current ? `In ${current.name}` : "This collection", here.length)}{here.map(renderRow)}</>}
          {elsewhere.length > 0 && <>{here.length > 0 || current ? heading("All moodboards", elsewhere.length) : null}{elsewhere.map(renderRow)}</>}
        </>}
    </div>
    {error && <p role="alert" className="border-t px-3 py-2 text-[11px]" style={{ borderColor: "var(--lm-border)", color: "var(--lm-coral)", fontFamily: "var(--lm-font-display)" }}>{error}</p>}
    <div className="border-t" style={{ borderColor: "var(--lm-border-strong)" }}>
      {creating ? <div className="grid gap-2 p-2.5">
        <input autoFocus value={draft} maxLength={MOODBOARD_LIMITS.name} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") void submitNew(); }}
          placeholder="Moodboard name" aria-label="New moodboard name" className="lm-field w-full border px-2.5 py-1.5 text-[12px] outline-none"
          style={{ background: "var(--lm-surface-0)", borderColor: "var(--lm-border-strong)", borderRadius: RADIUS, color: "var(--lm-text-primary)", fontFamily: "var(--lm-font-display)" }} />
        <div className="flex items-center gap-2">
          <select value={ownerFolderId} onChange={(event) => setOwnerFolderId(event.target.value)} aria-label="Collection the board belongs to"
            className="lm-field min-w-0 flex-1 border px-2 py-1.5 text-[11px] outline-none"
            style={{ background: "var(--lm-surface-0)", borderColor: "var(--lm-border-strong)", borderRadius: RADIUS, color: "var(--lm-text-secondary)" }}>
            {plainCollections.map((entry) => <option key={entry._id} value={entry._id}>
              {entry.parentFolderId ? `${nameOf.get(entry.parentFolderId) ?? ""} / ${entry.name}` : entry.name}
            </option>)}
          </select>
          <button type="button" disabled={!draft.trim() || !ownerFolderId || Boolean(busy)} onClick={() => void submitNew()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] disabled:opacity-50"
            style={{ borderRadius: RADIUS, background: "var(--lm-coral)", color: "var(--lm-paper)" }}>
            {busy === "new" ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Plus size={12} aria-hidden />}Create
          </button>
        </div>
      </div>
        : <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.12em] transition-opacity hover:opacity-75"
          style={{ color: "var(--lm-coral)" }}>
          <Plus size={12} aria-hidden />New moodboard
        </button>}
    </div>
  </div>, document.body);
}
