"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { LayoutGrid, Plus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { MoodboardStatus } from "@/lib/moodboards";
import {
  ActionButton, BoardBoundary, BoardCard, CreateMoodboard, Micro, MoodboardDetail, RADIUS, display, mono, plural,
  type MoodboardAssetSummary, type MoodboardCollectionOption, type MoodboardPickTarget, type MoodboardRow,
} from "./moodboards-view";

/** A plain collection as the tab needs it: worlds are roots, places are children. */
export type MoodboardsTabFolder = {
  _id: string;
  name: string;
  parentFolderId?: string;
  group?: string;
  kind?: string;
};

type StatusFilter = "all" | MoodboardStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "in-midjourney", label: "In Midjourney" },
  { key: "archived", label: "Archived" },
];

const FILTER_STORAGE_KEY = "laniameda-moodboards-filters";

const readStoredFilters = (): { world: string | null; status: StatusFilter } => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? "null") as { world?: unknown; status?: unknown } | null;
    const status = STATUS_FILTERS.some((entry) => entry.key === parsed?.status) ? parsed!.status as StatusFilter : "all";
    return { world: typeof parsed?.world === "string" ? parsed.world : null, status };
  } catch {
    return { world: null, status: "all" };
  }
};

const worldIdOf = (row: MoodboardRow) => String(row.parentFolderId ?? row.folderId);

// "Styles / Art Deco Animation" for a board on a child collection; the group
// is left out when it only repeats the name. A board on the root says so.
const placeOf = (row: MoodboardRow) => {
  if (!row.parentFolderId) return "World board";
  return row.folderGroup && row.folderGroup.toLowerCase() !== row.folderName.toLowerCase()
    ? `${row.folderGroup} / ${row.folderName}`
    : row.folderName;
};

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-1.5 md:grid-cols-[88px_minmax(0,1fr)] md:items-center md:gap-3">
    <Micro color="var(--lm-text-ghost)">{label}</Micro>
    {/* Chips scroll sideways on a phone instead of widening the page. */}
    <div className="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
      role="group" aria-label={label}>
      {children}
    </div>
  </div>;
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} title={title}
    className="lm-chip shrink-0 whitespace-nowrap" data-active={active ? "true" : undefined} style={{ borderRadius: RADIUS }}>
    {children}
  </button>;
}

/**
 * The Moodboards tab: every board in the gallery, grouped by the world it
 * belongs to, filterable by world and status. Opening a board shows it in
 * order with reorder, remove, its look line, its Midjourney code and the
 * Send to Midjourney export.
 */
export function MoodboardsTab({
  ownerUserId,
  folders,
  openBoardId,
  onOpenBoardChange,
  onOpenAsset,
  onChooseFromGallery,
}: {
  ownerUserId: string;
  /** Every plain collection of the owner (storybooks are left out here). */
  folders: MoodboardsTabFolder[];
  openBoardId: string | null;
  onOpenBoardChange: (id: string | null) => void;
  onOpenAsset: (asset: MoodboardAssetSummary) => void;
  onChooseFromGallery: (board: MoodboardPickTarget) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(api.moodboards.listMoodboards, isAuthenticated
    ? { ownerUserId, includeArchived: true, previewLimit: 4 }
    : "skip");
  // Filters are a per-viewer convenience: remembered, never required. The tab
  // only mounts on the client, after a click.
  const [world, setWorld] = useState<string | null>(() => readStoredFilters().world);
  const [status, setStatus] = useState<StatusFilter>(() => readStoredFilters().status);
  const [creating, setCreating] = useState(false);
  const topRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ world, status })); } catch { /* storage blocked */ }
  }, [world, status]);

  // A board opened far down the list starts at its own top.
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" });
  }, [openBoardId]);

  const plainFolders = useMemo(() => folders.filter((folder) => folder.kind === undefined), [folders]);
  const folderById = useMemo(() => new Map(plainFolders.map((folder) => [folder._id, folder])), [plainFolders]);

  const all = useMemo(() => rows ?? [], [rows]);
  const live = useMemo(() => all.filter((row) => row.status !== "archived"), [all]);

  // Worlds that hold boards, with their counts under the current status.
  const worlds = useMemo(() => {
    const byWorld = new Map<string, { id: string; name: string; count: number }>();
    for (const row of all) {
      const id = worldIdOf(row);
      const entry = byWorld.get(id) ?? { id, name: folderById.get(id)?.name ?? row.folderName, count: 0 };
      if (status === "all" ? row.status !== "archived" : row.status === status) entry.count += 1;
      byWorld.set(id, entry);
    }
    return [...byWorld.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [all, status, folderById]);

  // A remembered world that no longer holds boards falls back to all.
  const activeWorld = world && worlds.some((entry) => entry.id === world) ? world : null;

  const statusCounts = useMemo(() => {
    const scoped = activeWorld ? all.filter((row) => worldIdOf(row) === activeWorld) : all;
    return {
      all: scoped.filter((row) => row.status !== "archived").length,
      draft: scoped.filter((row) => row.status === "draft").length,
      "in-midjourney": scoped.filter((row) => row.status === "in-midjourney").length,
      archived: scoped.filter((row) => row.status === "archived").length,
    } satisfies Record<StatusFilter, number>;
  }, [all, activeWorld]);

  const groups = useMemo(() => {
    const visible = all.filter((row) =>
      (status === "all" ? row.status !== "archived" : row.status === status) &&
      (!activeWorld || worldIdOf(row) === activeWorld));
    const byWorld = new Map<string, MoodboardRow[]>();
    for (const row of visible) byWorld.set(worldIdOf(row), [...(byWorld.get(worldIdOf(row)) ?? []), row]);
    return [...byWorld.entries()]
      .map(([id, boards]) => ({
        id,
        name: folderById.get(id)?.name ?? boards[0]!.folderName,
        inMidjourney: boards.filter((row) => row.status === "in-midjourney").length,
        // World boards first, then each place, then by name.
        boards: [...boards].sort((a, b) =>
          Number(Boolean(a.parentFolderId)) - Number(Boolean(b.parentFolderId)) ||
          placeOf(a).localeCompare(placeOf(b)) || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, status, activeWorld, folderById]);

  // Where a new board can live: the filtered world, or every world and place.
  const createOptions = useMemo<MoodboardCollectionOption[]>(() => {
    const roots = plainFolders.filter((folder) => !folder.parentFolderId && (!activeWorld || folder._id === activeWorld))
      .sort((a, b) => a.name.localeCompare(b.name));
    return roots.flatMap((root) => [
      { _id: root._id, name: root.name },
      ...plainFolders.filter((folder) => folder.parentFolderId === root._id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => ({ _id: child._id, name: `${root.name} / ${child.name}`, parentFolderId: root._id })),
    ]);
  }, [plainFolders, activeWorld]);

  // An open board: its world's collections are where Edit may move it.
  const openRow = openBoardId ? all.find((row) => row._id === openBoardId) : undefined;
  const openWorldCollections = useMemo<MoodboardCollectionOption[]>(() => {
    if (!openRow) return [];
    const rootId = worldIdOf(openRow);
    return plainFolders
      .filter((folder) => folder._id === rootId || folder.parentFolderId === rootId)
      .map((folder) => ({ _id: folder._id, name: folder.name, parentFolderId: folder.parentFolderId, group: folder.group }));
  }, [openRow, plainFolders]);

  if (openBoardId) {
    return <section ref={topRef} className="scroll-mt-4">
      <BoardBoundary onBack={() => onOpenBoardChange(null)} resetKey={openBoardId} backLabel="All moodboards">
        <MoodboardDetail
          key={openBoardId}
          ownerUserId={ownerUserId}
          moodboardId={openBoardId as Id<"moodboards">}
          collections={openWorldCollections}
          onClose={() => onOpenBoardChange(null)}
          onOpenAsset={onOpenAsset}
          onChooseFromGallery={onChooseFromGallery}
          backLabel="All moodboards"
        />
      </BoardBoundary>
    </section>;
  }

  const inMidjourney = live.filter((row) => row.status === "in-midjourney").length;
  const worldCount = new Set(live.map(worldIdOf)).size;

  return <section ref={topRef} className="px-4 pb-24 pt-5 md:px-6 md:pt-6" style={{ color: "var(--lm-text-primary)" }} aria-labelledby="moodboards-tab-title">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 id="moodboards-tab-title" className="text-4xl font-black uppercase leading-[0.9] tracking-tight md:text-6xl" style={display}>Moodboards</h1>
        <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          {rows === undefined ? "Loading boards…" : [
            plural(live.length, "board"),
            inMidjourney ? `${inMidjourney} in Midjourney` : undefined,
            worldCount ? plural(worldCount, "world") : undefined,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
      <ActionButton tone={creating ? "ghost" : "ink"} disabled={!isAuthenticated} aria-expanded={creating}
        icon={creating ? <X size={13} aria-hidden /> : <Plus size={13} aria-hidden />} onClick={() => setCreating(!creating)}>
        {creating ? "Close" : "New moodboard"}
      </ActionButton>
    </header>
    <p className="mt-3 max-w-2xl text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
      Each board is one look: an ordered set of gallery images that belongs to its world and mirrors a Midjourney moodboard and its --profile code.
    </p>

    {creating && <div className="mt-5">
      <CreateMoodboard key={activeWorld ?? "all"} ownerUserId={ownerUserId} owners={createOptions}
        defaultFolderId={activeWorld ?? ""}
        onCreated={(id) => { setCreating(false); onOpenBoardChange(String(id)); }} />
    </div>}

    {(rows?.length ?? 0) > 0 && <div className="sticky top-0 z-20 -mx-4 mt-6 grid gap-2.5 border-b px-4 py-3 md:-mx-6 md:px-6"
      style={{ background: "color-mix(in srgb, var(--lm-paper) 92%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderColor: "var(--lm-border)" }}>
      <FilterRow label="World">
        <Chip active={!activeWorld} onClick={() => setWorld(null)}>All worlds<span className="opacity-60">{worlds.reduce((sum, entry) => sum + entry.count, 0)}</span></Chip>
        {worlds.map((entry) => <Chip key={entry.id} active={activeWorld === entry.id} onClick={() => setWorld(activeWorld === entry.id ? null : entry.id)}>
          {entry.name}<span className="opacity-60">{entry.count}</span>
        </Chip>)}
      </FilterRow>
      <FilterRow label="Status">
        {STATUS_FILTERS.filter((entry) => entry.key !== "archived" || statusCounts.archived > 0).map((entry) =>
          <Chip key={entry.key} active={status === entry.key} onClick={() => setStatus(entry.key)}
            title={entry.key === "all" ? "Every board that is not archived" : undefined}>
            {entry.label}<span className="opacity-60">{statusCounts[entry.key]}</span>
          </Chip>)}
      </FilterRow>
    </div>}

    {rows === undefined
      ? <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" aria-hidden>
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="aspect-[4/3.4] animate-pulse"
          style={{ borderRadius: RADIUS, background: "var(--lm-surface-1)", border: "1px solid var(--lm-border)" }} />)}
      </div>
      : groups.length === 0
        ? <div className="mt-8 border border-dashed px-6 py-16 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)" }}>
          <LayoutGrid className="mx-auto mb-3" size={22} style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
          <p className="text-sm font-black uppercase tracking-tight" style={display}>
            {all.length === 0 ? "No moodboards yet" : "No boards match"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
            {all.length === 0
              ? "Make one for a world, then choose its images from the gallery."
              : "Try another world or status."}
          </p>
          {all.length === 0 && !creating && <ActionButton tone="coral" className="mt-5" icon={<Plus size={13} aria-hidden />} onClick={() => setCreating(true)}>New moodboard</ActionButton>}
        </div>
        : <div className="mt-7 grid gap-11">
          {groups.map((group) => <section key={group.id} aria-label={`${group.name} moodboards`}>
            <div className="mb-3.5 flex items-baseline gap-3">
              <button type="button" onClick={() => setWorld(activeWorld === group.id ? null : group.id)}
                className="min-w-0 truncate border-none bg-transparent p-0 text-left text-xl font-black uppercase leading-none tracking-tight transition-colors hover:text-[var(--lm-coral)] md:text-2xl"
                style={display} title={activeWorld === group.id ? "Show every world" : `Only ${group.name}`}>
                {group.name}
              </button>
              <Micro color="var(--lm-text-ghost)" className="shrink-0">
                {plural(group.boards.length, "board")}{group.inMidjourney ? ` · ${group.inMidjourney} in MJ` : ""}
              </Micro>
              <span aria-hidden className="h-px min-w-6 flex-1 self-center" style={{ background: "var(--lm-border)" }} />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {group.boards.map((row) => <BoardCard key={row._id} row={row} place={placeOf(row)} onOpen={() => onOpenBoardChange(String(row._id))} />)}
            </div>
          </section>)}
        </div>}
  </section>;
}
