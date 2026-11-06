"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Lightbulb, Loader2, Type } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CopyChip, Micro, RADIUS, display, errorText, mono } from "@/components/inbox/inbox-ui";
import {
  ADAPTATION_STATUS_LABEL, PLATFORM_LABEL, inspirationPath, type InspirationAdaptationStatus, type InspirationPlatform,
} from "@/lib/inspiration";
import { Chip, HAIR, RULE } from "./parts";

// /inspiration: the library of saved references. Raw sources and their
// project takes are told apart on every tile: the source picture is the
// tile; a take shows as a chip (and a small inset of the newest output).
// Keys on the hovered tile: 1 keep, 2 drop / restore, O open, C note.
// Every key has a tap equivalent on the review page.

type Row = FunctionReturnType<typeof api.inspiration.listInspiration>["rows"][number];

type Filters = {
  view: "active" | "kept" | "new" | "dropped";
  kind?: "media" | "text";
  stage?: "raw" | "adapted" | InspirationAdaptationStatus;
  platform?: InspirationPlatform;
  category?: string;
  world?: string;
};

const VIEWS: Array<{ key: Filters["view"]; label: string }> = [
  { key: "active", label: "All" }, { key: "new", label: "New" }, { key: "kept", label: "Kept" }, { key: "dropped", label: "Archive" },
];
const STAGES: Array<{ key: NonNullable<Filters["stage"]>; label: string }> = [
  { key: "raw", label: "Raw only" }, { key: "adapted", label: "Has a take" }, { key: "ready", label: "Ready to review" },
  { key: "changes_requested", label: "Change requested" }, { key: "approved", label: "Approved" }, { key: "blocked", label: "Blocked" },
];

function FilterChip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return <button type="button" onClick={onClick} aria-pressed={active}
    className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.12em] active:scale-[0.97]"
    style={{ ...mono, borderRadius: RADIUS, border: active ? "1px solid var(--lm-ink)" : "1px solid var(--lm-border-strong)", background: active ? "var(--lm-ink)" : "transparent", color: active ? "var(--lm-paper)" : "var(--lm-text-secondary)" }}>
    {children}{count !== undefined && <span className="opacity-60">{count}</span>}
  </button>;
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2">
    <span className="w-[62px] shrink-0"><Micro color="var(--lm-text-ghost)">{label}</Micro></span>
    <div className="-mr-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-4 [scrollbar-width:none]">{children}</div>
  </div>;
}

function StatusChip({ row }: { row: Row["adaptations"][number] }) {
  const tone = row.status === "ready" ? "coral" : row.status === "approved" ? "ink" : "ghost";
  return <Chip tone={tone} onPicture={tone === "ghost"}>{row.promoted ? "Promoted" : ADAPTATION_STATUS_LABEL[row.status]} · {row.targetLabel}</Chip>;
}

function Tile({ row, archivedNow, onHover, focused }: { row: Row; archivedNow: boolean; onHover: (row: Row | null) => void; focused: boolean }) {
  const dropped = row.review === "dropped" || archivedNow;
  const lead = row.lead && !row.lead.missing ? row.lead : undefined;
  const ratio = lead?.width && lead?.height ? `${lead.width} / ${lead.height}` : row.kind === "text" ? "4 / 5" : "4 / 5";
  const inset = row.adaptations.find((item) => item.latestOutput)?.latestOutput;
  return <div className="relative mb-2 break-inside-avoid" onMouseEnter={() => onHover(row)} onMouseLeave={() => onHover(null)}
    style={{ opacity: dropped ? 0.42 : 1, filter: dropped ? "grayscale(1)" : undefined, outline: focused ? "1px solid var(--lm-border-strong)" : undefined, borderRadius: RADIUS }}>
    <Link href={inspirationPath(row.sourceId)} className="block overflow-hidden active:opacity-80" style={{ borderRadius: RADIUS, background: "var(--lm-surface-2)" }}
      aria-label={`Open ${row.title}`}>
      {lead
        // eslint-disable-next-line @next/next/no-img-element -- stored thumbnail at its own ratio
        ? <img src={lead.thumbUrl ?? lead.url} alt="" loading="lazy" decoding="async" className="block w-full" style={{ aspectRatio: ratio, objectFit: "cover" }} />
        : <div className="flex w-full flex-col justify-between p-3" style={{ aspectRatio: ratio, background: "var(--lm-surface-1)", border: HAIR, borderRadius: RADIUS }}>
          <Type size={16} style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
          <p className="line-clamp-6 text-[15px] font-black uppercase leading-[1.1] tracking-tight" style={display}>{row.title}</p>
          <p className="line-clamp-3 text-[11px] leading-4" style={{ color: "var(--lm-text-tertiary)" }}>{row.text ?? row.caption ?? ""}</p>
        </div>}
    </Link>
    <div className="pointer-events-none absolute left-1.5 top-1.5 flex max-w-[calc(100%-12px)] flex-wrap gap-1">
      <Chip onPicture>{PLATFORM_LABEL[row.platform]}</Chip>
      {row.kind === "media" && row.expectedCount !== undefined && row.expectedCount > 1 && <Chip onPicture>{row.savedCount}/{row.expectedCount}</Chip>}
      {row.review === "kept" && !dropped && <Chip tone="ink">Kept</Chip>}
      {dropped && <Chip tone="ink">Archived</Chip>}
    </div>
    {inset?.thumbUrl && <span className="pointer-events-none absolute bottom-9 right-1.5 block w-[34%] overflow-hidden" style={{ borderRadius: RADIUS, border: "2px solid var(--lm-paper)", boxShadow: "var(--lm-shadow-md)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- draft output thumbnail */}
      <img src={inset.thumbUrl} alt="" loading="lazy" className="block w-full" style={{ aspectRatio: inset.width && inset.height ? `${inset.width} / ${inset.height}` : "1 / 1", objectFit: "cover" }} />
    </span>}
    <div className="mt-1 flex items-start justify-between gap-1.5 px-0.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-black uppercase leading-4 tracking-tight" style={display}>{row.title}</p>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {row.adaptations.length === 0 ? <Chip tone="quiet">Raw</Chip> : row.adaptations.slice(0, 2).map((item) => <StatusChip key={item.adaptationId} row={item} />)}
        </div>
        {row.ownerNote && <p className="mt-1 line-clamp-2 text-[11px] leading-4" style={{ color: "var(--lm-text-secondary)" }}>“{row.ownerNote}”</p>}
      </div>
      <CopyChip value={`inspiration:${row.sourceId}`} label="" title={`Copy inspiration:${row.sourceId}`} />
    </div>
  </div>;
}

function Page({ ownerUserId, filters, before, onNext, onRows }: {
  ownerUserId: string; filters: Filters; before?: number;
  onNext: (next: number | undefined) => void; onRows: (rows: Row[]) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const stage = filters.stage;
  const page = useQuery(api.inspiration.listInspiration, isAuthenticated ? {
    ownerUserId,
    // The archive shows dropped sources; every other view also keeps the ones
    // dropped just now visible, grayed, until the page is left.
    review: filters.view === "active" ? "all" : filters.view,
    kind: filters.kind, platform: filters.platform, category: filters.category,
    adapted: stage === "raw" || stage === "adapted" ? stage : undefined,
    status: stage && stage !== "raw" && stage !== "adapted" ? stage : undefined,
    targetWorldId: filters.world as Id<"folders"> | undefined,
    includeDrafts: true, before, limit: 30,
  } : "skip");
  useEffect(() => { if (page) { onNext(page.nextBefore); onRows(page.rows); } }, [page, onNext, onRows]);
  return null;
}

export function InspirationLibrary({ ownerUserId }: { ownerUserId: string }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({ view: "active" });
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);
  const [pages, setPages] = useState<Record<number, Row[]>>({});
  const [next, setNext] = useState<number | undefined>();
  const [droppedNow, setDroppedNow] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<Row | null>(null);
  const [flash, setFlash] = useState<string>();
  const review = useMutation(api.inspiration.reviewInspirationSource);

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([undefined]); setPages({}); setNext(undefined);
  };

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const all = cursors.flatMap((_, index) => pages[index] ?? []).filter((row) => !seen.has(row.sourceId) && Boolean(seen.add(row.sourceId)));
    // "All" hides the archive except what was dropped on this visit.
    return filters.view === "active" ? all.filter((row) => row.review !== "dropped" || droppedNow.has(row.sourceId)) : all;
  }, [cursors, pages, filters.view, droppedNow]);
  const loading = pages[0] === undefined;

  // Facets come from what is loaded: platforms, categories, projects.
  const facets = useMemo(() => {
    const platforms = new Map<InspirationPlatform, number>();
    const categories = new Map<string, number>();
    const worlds = new Map<string, string>();
    for (const row of rows) {
      platforms.set(row.platform, (platforms.get(row.platform) ?? 0) + 1);
      for (const category of row.categories) categories.set(category, (categories.get(category) ?? 0) + 1);
      for (const item of row.adaptations) if (item.targetWorldId) worlds.set(item.targetWorldId, item.targetLabel.split(" · ")[0]!);
    }
    return { platforms: [...platforms], categories: [...categories].sort((a, b) => b[1] - a[1]).slice(0, 12), worlds: [...worlds] };
  }, [rows]);

  // 1 keep / 2 drop on the hovered tile. Each press is its own intent.
  const hoveredRef = useRef(hovered);
  hoveredRef.current = hovered;
  const send = useCallback(async (eventKey: string, action: "keep" | "unkeep" | "drop" | "recover", row: Row) => {
    await review({ ownerUserId, sourceId: row.sourceId, eventKey, action, expectedRevision: row.revision });
  }, [ownerUserId, review]);
  const busy = useRef(false);
  const [keyError, setKeyError] = useState<string>();
  const press = useCallback(async (action: "keep" | "unkeep" | "drop" | "recover", row: Row) => {
    if (busy.current) return;
    busy.current = true; setKeyError(undefined);
    try {
      await send(crypto.randomUUID(), action, row);
      if (action === "drop") setDroppedNow((current) => new Set(current).add(row.sourceId));
      setFlash(action === "keep" ? "Kept" : action === "unkeep" ? "Unkept" : action === "drop" ? "Archived" : "Restored");
      setTimeout(() => setFlash(undefined), 1100);
    } catch (error) {
      setKeyError(errorText(error, "That did not go through."));
    } finally {
      busy.current = false;
    }
  }, [send]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, [contenteditable=true]")) return;
      const row = hoveredRef.current;
      if (!row) return;
      const dropped = row.review === "dropped";
      if (event.key === "1") void press(row.review === "kept" ? "unkeep" : "keep", row);
      else if (event.key === "2") void press(dropped ? "recover" : "drop", row);
      else if (event.key.toLowerCase() === "o") router.push(inspirationPath(row.sourceId));
      else if (event.key.toLowerCase() === "c") router.push(`${inspirationPath(row.sourceId)}#note`);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, router]);

  const onRowsFor = useMemo(() => cursors.map((_, index) => (list: Row[]) => setPages((current) => ({ ...current, [index]: list }))), [cursors]);
  const onNextFor = useMemo(() => cursors.map((_, index) => (value: number | undefined) => { if (index === cursors.length - 1) setNext(value); }), [cursors]);

  return <main className="min-h-dvh px-4 pb-24 md:px-8" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)", paddingTop: "max(16px, env(safe-area-inset-top))" }}>
    {cursors.map((before, index) => <Page key={`${index}-${before ?? "first"}-${JSON.stringify(filters)}`} ownerUserId={ownerUserId} filters={filters} before={before}
      onNext={onNextFor[index]!} onRows={onRowsFor[index]!} />)}
    <div className="mx-auto max-w-6xl">
      <header className="pb-4" style={{ borderBottom: RULE }}>
        <Link href="/" className="inline-flex min-h-[36px] items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          <ArrowLeft size={12} aria-hidden /> Gallery
        </Link>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <Micro color="var(--lm-coral)">Library · what you saved and what we made from it</Micro>
            <h1 className="mt-1 text-[44px] font-black uppercase leading-[0.9] tracking-tight md:text-[64px]" style={display}>Inspiration</h1>
          </div>
          <Lightbulb size={32} strokeWidth={1.5} className="mb-1 shrink-0" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
        </div>
        <p className="mt-2 max-w-xl text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
          A reference stays a reference: nothing here is filed into a project until you approve a take and promote it. Notes never start work.
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-1.5 px-4 py-3 md:-mx-8 md:px-8" style={{ background: "color-mix(in srgb, var(--lm-paper) 92%, transparent)", backdropFilter: "blur(10px)", borderBottom: HAIR }}>
        <ChipRow label="Show">{VIEWS.map((view) => <FilterChip key={view.key} active={filters.view === view.key} onClick={() => setFilter({ view: view.key })}>{view.label}</FilterChip>)}</ChipRow>
        <ChipRow label="Stage">
          <FilterChip active={!filters.stage} onClick={() => setFilter({ stage: undefined })}>Any</FilterChip>
          {STAGES.map((stage) => <FilterChip key={stage.key} active={filters.stage === stage.key} onClick={() => setFilter({ stage: filters.stage === stage.key ? undefined : stage.key })}>{stage.label}</FilterChip>)}
        </ChipRow>
        <ChipRow label="Kind">
          <FilterChip active={!filters.kind} onClick={() => setFilter({ kind: undefined })}>Any</FilterChip>
          <FilterChip active={filters.kind === "media"} onClick={() => setFilter({ kind: filters.kind === "media" ? undefined : "media" })}>Pictures</FilterChip>
          <FilterChip active={filters.kind === "text"} onClick={() => setFilter({ kind: filters.kind === "text" ? undefined : "text" })}>Ideas</FilterChip>
          {facets.platforms.map(([platform, count]) => <FilterChip key={platform} active={filters.platform === platform} count={count}
            onClick={() => setFilter({ platform: filters.platform === platform ? undefined : platform })}>{PLATFORM_LABEL[platform]}</FilterChip>)}
        </ChipRow>
        {(facets.worlds.length > 0 || filters.world) && <ChipRow label="Project">
          <FilterChip active={!filters.world} onClick={() => setFilter({ world: undefined })}>Any</FilterChip>
          {facets.worlds.map(([id, name]) => <FilterChip key={id} active={filters.world === id} onClick={() => setFilter({ world: filters.world === id ? undefined : id })}>{name}</FilterChip>)}
        </ChipRow>}
        {(facets.categories.length > 0 || filters.category) && <ChipRow label="About">
          <FilterChip active={!filters.category} onClick={() => setFilter({ category: undefined })}>Any</FilterChip>
          {facets.categories.map(([category, count]) => <FilterChip key={category} active={filters.category === category} count={count}
            onClick={() => setFilter({ category: filters.category === category ? undefined : category })}>{category}</FilterChip>)}
        </ChipRow>}
      </div>

      {loading
        ? <div className="grid place-items-center py-32"><Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>
        : rows.length === 0
          ? <div className="mt-8 border px-6 py-14 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", borderStyle: "dashed" }}>
            <p className="text-sm font-black uppercase tracking-tight" style={display}>{filters.view === "dropped" ? "The archive is empty" : "Nothing here yet"}</p>
            <p className="mx-auto mt-2 max-w-sm text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
              Agents add references here with register_inspiration once a source is saved. Change the filters to see more.
            </p>
          </div>
          : <div className="mt-4 columns-2 gap-2 md:columns-3 lg:columns-4">
            {rows.map((row) => <Tile key={row.sourceId} row={row} archivedNow={droppedNow.has(row.sourceId)} onHover={setHovered} focused={hovered?.sourceId === row.sourceId} />)}
          </div>}

      {next !== undefined && !loading && <div className="mt-6 flex justify-center">
        <button type="button" onClick={() => setCursors((current) => [...current, next])}
          className="min-h-[44px] px-5 text-[11px] font-black uppercase tracking-[0.12em]" style={{ ...mono, borderRadius: RADIUS, border: "1px solid var(--lm-border-strong)" }}>More</button>
      </div>}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 hidden justify-center pb-4 md:flex">
        <span className="flex items-center gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-ink)", color: "var(--lm-paper)" }}>
          {flash ?? keyError ?? <>1 keep · 2 drop / restore · O open · C note</>}
        </span>
      </div>
      {(flash || keyError) && <div className="fixed inset-x-4 bottom-4 z-20 md:hidden">
        <span className="block px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.12em]" style={{ ...mono, borderRadius: RADIUS, background: "var(--lm-ink)", color: "var(--lm-paper)" }}>{flash ?? keyError}</span>
      </div>}
    </div>
  </main>;
}
