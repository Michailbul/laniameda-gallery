"use client";

/* eslint-disable @next/next/no-img-element -- the shared board renders raw
   <img>/<video> like review-modal; next/image adds no value for R2 URLs. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "convex/react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  LayoutGrid,
  Play,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DEFAULT_GAP_PX, layoutJustified } from "@/lib/masonry-layout";
import {
  StackHoverPreviewOverlay,
  useStackHoverPreview,
} from "@/components/gallery/stack-hover-preview";

type TypeFilter = "all" | "image" | "video";

/** The board's layers. Each layer holds "directions" — collections of similar
 * options thumbed by their master (cover) asset. */
type BoardSection = "characters" | "locations" | "beats";

const SECTION_ORDER: { key: BoardSection; label: string; blurb: string }[] = [
  {
    key: "characters",
    label: "Characters",
    blurb: "Alternate takes on the cast. One stack = one direction.",
  },
  {
    key: "locations",
    label: "Locations",
    blurb: "Where it happens. One stack = one direction.",
  },
  {
    key: "beats",
    label: "Beats",
    blurb: "A character direction meets a location — with the resulting shot.",
  },
];

/** What the viewer is looking at: the scrollable overview, one opened
 * direction, or the flat everything grid. */
type BoardView =
  | { type: "overview" }
  | { type: "direction"; id: string }
  | { type: "all" };

type DirectionSort = "curated" | "name" | "options";

type BoardAsset = {
  id: string;
  kind: "image" | "video";
  contentType?: string;
  url?: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  fileName?: string;
  title?: string;
  approved: boolean;
  collectionId: string;
  collectionName: string;
};

/** A paired direction reference shown on a beat card. */
type PairRef = {
  id: string;
  name: string;
  thumb?: string;
};

type BoardDirection = {
  id: string;
  name: string;
  count: number;
  cover: BoardAsset | null;
  /** Thumb urls of the next variations, peeking behind the master. */
  backs: string[];
  /** Thumb urls (master first) for the hover-to-preview rotation. */
  previews: string[];
  /** Beat pairing (beats layer only). */
  pairCharacter?: PairRef;
  pairLocation?: PairRef;
};

/**
 * Public, read-only direction board for a shared project, built to be read
 * top-to-bottom by someone who has never seen the tool: project header, then
 * one section per layer (Characters / Locations / Beats) with direction
 * stacks, then a link to the flat everything-grid. Clicking a stack opens its
 * options in a dedicated masonry with a Back button.
 */
export function DirectionBoard({ token }: { token: string }) {
  const board = useQuery(api.directionBoard.getBoard, { token });

  const [view, setView] = useState<BoardView>({ type: "overview" });
  const [sort, setSort] = useState<DirectionSort>("curated");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  // Overview scroll position, restored when backing out of a drill-in.
  const overviewScrollRef = useRef(0);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setGridWidth(Math.round(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  type BoardCollection = NonNullable<typeof board>["collections"][number];

  const toBoardAsset = useCallback(
    (
      asset: BoardCollection["assets"][number],
      collection: BoardCollection,
    ): BoardAsset => ({
      id: asset.id as string,
      kind: asset.kind,
      contentType: asset.contentType,
      url: asset.url,
      thumbUrl: asset.thumbUrl,
      width: asset.width,
      height: asset.height,
      fileName: asset.fileName,
      title: asset.title,
      approved: asset.approved,
      collectionId: collection.id as string,
      collectionName: collection.name,
    }),
    [],
  );

  const sectionOf = (section: string | undefined): BoardSection | "unsorted" =>
    (section as BoardSection | undefined) ?? "unsorted";

  const collections = useMemo(
    () => board?.collections ?? [],
    [board],
  );

  // id → collection, for beat pairing lookups.
  const collectionById = useMemo(() => {
    const map = new Map<string, BoardCollection>();
    for (const collection of collections) {
      map.set(collection.id as string, collection);
    }
    return map;
  }, [collections]);

  const resolveCover = useCallback((collection: BoardCollection) => {
    const coverId = collection.coverAssetId as string | undefined;
    return (
      (coverId &&
        collection.assets.find((a) => (a.id as string) === coverId)) ||
      collection.assets[0] ||
      null
    );
  }, []);

  const pairRef = useCallback(
    (folderId: string | undefined): PairRef | undefined => {
      if (!folderId) return undefined;
      const collection = collectionById.get(folderId);
      if (!collection) return undefined;
      const cover = resolveCover(collection);
      return {
        id: collection.id as string,
        name: collection.name,
        thumb: cover ? (cover.thumbUrl ?? cover.url) : undefined,
      };
    },
    [collectionById, resolveCover],
  );

  const toDirection = useCallback(
    (collection: BoardCollection): BoardDirection => {
      const coverAsset = resolveCover(collection);
      const backs = collection.assets
        .filter((a) => a !== coverAsset)
        .slice(0, 2)
        .map((a) => a.thumbUrl ?? a.url)
        .filter((src): src is string => Boolean(src));
      const previews = (coverAsset
        ? [coverAsset, ...collection.assets.filter((a) => a !== coverAsset)]
        : collection.assets
      )
        .slice(0, 8)
        .map((a) => a.thumbUrl ?? a.url)
        .filter((src): src is string => Boolean(src));
      return {
        id: collection.id as string,
        name: collection.name,
        count: collection.count,
        cover: coverAsset ? toBoardAsset(coverAsset, collection) : null,
        backs,
        previews,
        pairCharacter: pairRef(
          collection.beatCharacterFolderId as string | undefined,
        ),
        pairLocation: pairRef(
          collection.beatLocationFolderId as string | undefined,
        ),
      };
    },
    [resolveCover, toBoardAsset, pairRef],
  );

  const sortDirections = useCallback(
    (list: BoardDirection[]) => {
      if (sort === "name") {
        return [...list].sort((a, b) => a.name.localeCompare(b.name));
      }
      if (sort === "options") {
        return [...list].sort((a, b) => b.count - a.count);
      }
      return list;
    },
    [sort],
  );

  // Directions bucketed per layer, in the owner's curated order (then sorted).
  const sections = useMemo(() => {
    const buckets: Record<BoardSection | "unsorted", BoardDirection[]> = {
      characters: [],
      locations: [],
      beats: [],
      unsorted: [],
    };
    for (const collection of collections) {
      buckets[sectionOf(collection.section)].push(toDirection(collection));
    }
    return {
      characters: sortDirections(buckets.characters),
      locations: sortDirections(buckets.locations),
      beats: sortDirections(buckets.beats),
      unsorted: sortDirections(buckets.unsorted),
    };
  }, [collections, toDirection, sortDirections]);

  const anySectioned = useMemo(
    () => collections.some((c) => c.section),
    [collections],
  );

  // The opened direction, if it still exists.
  const openDirection = useMemo<BoardCollection | null>(
    () =>
      (view.type === "direction" && collectionById.get(view.id)) || null,
    [view, collectionById],
  );

  // Flatten the current scope → assets. Opened direction wins; the flat
  // everything view dedupes by asset id (first collection wins the label).
  const assets = useMemo<BoardAsset[]>(() => {
    if (view.type === "overview") return [];
    const source = openDirection ? [openDirection] : collections;
    const out: BoardAsset[] = [];
    const seen = new Set<string>();
    for (const collection of source) {
      for (const asset of collection.assets) {
        const id = asset.id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(toBoardAsset(asset, collection));
      }
    }
    return out;
  }, [view.type, openDirection, collections, toBoardAsset]);

  const approvedCount = useMemo(
    () => assets.filter((asset) => asset.approved).length,
    [assets],
  );

  const visibleAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          (typeFilter === "all" || asset.kind === typeFilter) &&
          (!approvedOnly || asset.approved),
      ),
    [assets, typeFilter, approvedOnly],
  );

  const layout = useMemo(() => {
    const targetRowHeight = Math.max(
      200,
      Math.min(340, Math.round(gridWidth / 4.2)),
    );
    return layoutJustified(
      visibleAssets.map((asset) => ({
        width: asset.width,
        height: asset.height,
        kind: asset.kind,
        contentType: asset.contentType,
      })),
      { containerWidth: gridWidth, gap: DEFAULT_GAP_PX, targetRowHeight },
    );
  }, [visibleAssets, gridWidth]);

  const openDirectionById = useCallback((id: string) => {
    overviewScrollRef.current = window.scrollY;
    setView({ type: "direction", id });
    setFocusId(null);
    window.scrollTo(0, 0);
  }, []);

  const backToOverview = useCallback(() => {
    setView({ type: "overview" });
    setFocusId(null);
    requestAnimationFrame(() =>
      window.scrollTo(0, overviewScrollRef.current),
    );
  }, []);

  const focusIndex = focusId
    ? visibleAssets.findIndex((asset) => asset.id === focusId)
    : -1;
  const focusAsset = focusIndex >= 0 ? visibleAssets[focusIndex] : null;

  const goFocus = useCallback(
    (delta: number) => {
      setFocusId((current) => {
        if (!current) return current;
        const idx = visibleAssets.findIndex((asset) => asset.id === current);
        if (idx < 0) return current;
        const nextIdx = Math.min(
          visibleAssets.length - 1,
          Math.max(0, idx + delta),
        );
        return visibleAssets[nextIdx]?.id ?? current;
      });
    },
    [visibleAssets],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (focusId) {
          e.preventDefault();
          setFocusId(null);
        } else if (view.type !== "overview") {
          e.preventDefault();
          backToOverview();
        }
        return;
      }
      if (!focusId) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goFocus(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goFocus(1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [focusId, view.type, goFocus, backToOverview]);

  // Keep the active filmstrip thumb centered as focus moves.
  useEffect(() => {
    if (!focusId) return;
    activeThumbRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [focusId]);

  const isLoading = board === undefined;
  const notFound = board === null;
  const totalAssets = useMemo(() => {
    const seen = new Set<string>();
    for (const collection of collections) {
      for (const asset of collection.assets) seen.add(asset.id as string);
    }
    return seen.size;
  }, [collections]);

  const visibleSections = SECTION_ORDER.filter(
    ({ key }) => sections[key].length > 0,
  );
  const unsortedLabel = anySectioned ? "More" : "Directions";

  const scrollToSection = (key: string) => {
    document
      .getElementById(`board-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className="lm-grid-bg min-h-screen"
      style={{
        backgroundColor: "var(--lm-paper)",
        color: "var(--lm-text-primary)",
        fontFamily: "var(--lm-font)",
      }}
    >
      {/* ── Header ── */}
      <header className="mx-auto max-w-[1500px] px-4 pt-6 md:px-8 md:pt-10">
        <div className="flex items-center justify-between gap-3">
          <span
            className="text-[11px] font-mono font-bold uppercase tracking-[0.18em]"
            style={{ color: "var(--lm-text-secondary)" }}
          >
            <span style={{ color: "var(--lm-coral)" }}>●</span> Laniameda
          </span>
          <span
            className="text-[10px] font-mono uppercase tracking-[0.16em]"
            style={{ color: "var(--lm-text-ghost)" }}
          >
            Shared direction board
          </span>
        </div>

        {!isLoading && !notFound && view.type === "overview" && (
          <div className="mt-8 md:mt-12">
            <p
              className="text-[11px] font-mono font-bold uppercase tracking-[0.2em]"
              style={{ color: "var(--lm-coral)" }}
            >
              Direction
            </p>
            <h1
              className="mt-2 text-4xl md:text-6xl"
              style={{
                fontFamily: "var(--font-display), Georgia, serif",
                color: "var(--lm-text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              {board.name}
            </h1>
            {board.brief && (
              <p
                className="mt-3 max-w-[68ch] text-[14px] leading-relaxed"
                style={{ color: "var(--lm-text-secondary)" }}
              >
                {board.brief}
              </p>
            )}
            <p
              className="mt-3 text-[11px] font-mono uppercase tracking-wider"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              {totalAssets} assets
              {board.updatedAt
                ? ` · updated ${new Date(board.updatedAt).toLocaleDateString()}`
                : ""}
            </p>
            <p
              className="mt-4 max-w-[70ch] text-[12px] leading-relaxed"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              Each stack is one direction — a set of options for a character
              or location. Hover a stack to flip through it, click to open
              every option. Save downloads any file.
            </p>
          </div>
        )}
      </header>

      {/* ── Sticky nav ── */}
      {!isLoading && !notFound && (
        <div
          className="sticky top-0 z-20 mt-6"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--lm-paper) 92%, transparent)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: "1px solid var(--lm-border)",
          }}
        >
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-4 py-3 md:px-8">
            {view.type === "overview" ? (
              <>
                {visibleSections.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => scrollToSection(key)}
                    className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors hover:opacity-80"
                    style={{
                      borderColor: "var(--lm-border-strong)",
                      color: "var(--lm-text-secondary)",
                    }}
                  >
                    {label}
                    <span style={{ opacity: 0.6 }}>
                      {" "}
                      {sections[key].length}
                    </span>
                  </button>
                ))}
                {sections.unsorted.length > 0 && (
                  <button
                    type="button"
                    onClick={() => scrollToSection("unsorted")}
                    className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors hover:opacity-80"
                    style={{
                      borderColor: "var(--lm-border-strong)",
                      color: "var(--lm-text-secondary)",
                    }}
                  >
                    {unsortedLabel}
                    <span style={{ opacity: 0.6 }}>
                      {" "}
                      {sections.unsorted.length}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    overviewScrollRef.current = window.scrollY;
                    setView({ type: "all" });
                    window.scrollTo(0, 0);
                  }}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors hover:opacity-80"
                  style={{
                    borderColor: "var(--lm-border-strong)",
                    color: "var(--lm-text-secondary)",
                  }}
                >
                  <LayoutGrid className="h-3 w-3" />
                  All assets
                  <span style={{ opacity: 0.6 }}>{totalAssets}</span>
                </button>

                {/* Sort */}
                <span
                  className="ml-auto text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
                  style={{ color: "var(--lm-text-ghost)" }}
                >
                  Sort
                </span>
                {(
                  [
                    ["curated", "Curated"],
                    ["name", "A–Z"],
                    ["options", "Most options"],
                  ] as const
                ).map(([value, label]) => {
                  const active = sort === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSort(value)}
                      className="rounded-full border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
                      style={{
                        borderColor: active
                          ? "var(--lm-coral)"
                          : "var(--lm-border-strong)",
                        color: active
                          ? "var(--lm-coral)"
                          : "var(--lm-text-tertiary)",
                      }}
                      aria-pressed={active}
                    >
                      {label}
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={backToOverview}
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                  style={{
                    borderColor: "var(--lm-border-strong)",
                    color: "var(--lm-text-secondary)",
                  }}
                  title="Back to the board (Esc)"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {board.name}
                </button>
                <span
                  className="truncate text-[15px] font-semibold"
                  style={{ color: "var(--lm-text-primary)" }}
                >
                  {view.type === "all"
                    ? "All assets"
                    : openDirection?.name ?? "Direction"}
                </span>
                <span
                  className="text-[11px] font-mono uppercase tracking-wider"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  {view.type === "all"
                    ? `${totalAssets} assets`
                    : `${openDirection?.count ?? 0} options`}
                </span>
                {openDirection && (
                  <a
                    href={`/api/board/direction-pdf?token=${encodeURIComponent(
                      token,
                    )}&folderId=${encodeURIComponent(
                      openDirection.id as string,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                    style={{
                      borderColor: "var(--lm-border-strong)",
                      color: "var(--lm-text-secondary)",
                    }}
                    title="Download this direction as a PDF (images embedded, videos as links)"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    PDF
                  </a>
                )}

                <span
                  className="mx-1 hidden h-4 w-px sm:block"
                  style={{ backgroundColor: "var(--lm-border-strong)" }}
                />
                {(
                  [
                    ["all", "All"],
                    ["image", "Stills"],
                    ["video", "Videos"],
                  ] as const
                ).map(([value, label]) => {
                  const active = typeFilter === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTypeFilter(value)}
                      className="rounded-full border px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
                      style={{
                        borderColor: active
                          ? "var(--lm-text-secondary)"
                          : "var(--lm-border-strong)",
                        color: active
                          ? "var(--lm-text-primary)"
                          : "var(--lm-text-tertiary)",
                      }}
                      aria-pressed={active}
                    >
                      {label}
                    </button>
                  );
                })}
                {approvedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setApprovedOnly((v) => !v)}
                    className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
                    style={{
                      borderColor: approvedOnly
                        ? "var(--lm-coral)"
                        : "var(--lm-border-strong)",
                      backgroundColor: approvedOnly
                        ? "var(--lm-coral)"
                        : "transparent",
                      color: approvedOnly ? "#000" : "var(--lm-text-tertiary)",
                    }}
                    aria-pressed={approvedOnly}
                    title="Show only approved"
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                    Approved {approvedCount}
                  </button>
                )}
                <span
                  className="ml-auto text-[11px] font-mono"
                  style={{ color: "var(--lm-text-ghost)" }}
                >
                  {visibleAssets.length} shown
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <main className="mx-auto max-w-[1500px] px-4 pb-20 pt-5 md:px-8">
        <div ref={gridRef}>
          {isLoading ? (
            <p
              className="py-24 text-center text-[13px]"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              Loading board…
            </p>
          ) : notFound ? (
            <div className="py-24 text-center">
              <p
                className="text-[15px] font-semibold"
                style={{ color: "var(--lm-text-primary)" }}
              >
                This link isn’t active
              </p>
              <p
                className="mt-2 text-[13px]"
                style={{ color: "var(--lm-text-tertiary)" }}
              >
                The board may have been unshared. Ask the sender for a fresh
                link.
              </p>
            </div>
          ) : view.type === "overview" ? (
            <>
              {visibleSections.map(({ key, label, blurb }) => (
                <section
                  key={key}
                  id={`board-${key}`}
                  className="scroll-mt-20 pt-8 first:pt-2"
                >
                  <SectionHeader
                    label={label}
                    count={sections[key].length}
                    blurb={blurb}
                  />
                  <DirectionGrid
                    directions={sections[key]}
                    gridWidth={gridWidth}
                    isBeats={key === "beats"}
                    onOpen={openDirectionById}
                  />
                </section>
              ))}

              {sections.unsorted.length > 0 && (
                <section
                  id="board-unsorted"
                  className="scroll-mt-20 pt-8"
                >
                  <SectionHeader
                    label={unsortedLabel}
                    count={sections.unsorted.length}
                    blurb="Directions not filed under a layer yet."
                  />
                  <DirectionGrid
                    directions={sections.unsorted}
                    gridWidth={gridWidth}
                    isBeats={false}
                    onOpen={openDirectionById}
                  />
                </section>
              )}

              {visibleSections.length === 0 &&
                sections.unsorted.length === 0 && (
                  <p
                    className="py-24 text-center text-[13px]"
                    style={{ color: "var(--lm-text-tertiary)" }}
                  >
                    Nothing on this board yet.
                  </p>
                )}

              {totalAssets > 0 && (
                <div
                  className="mt-14 flex justify-center border-t pt-8"
                  style={{ borderColor: "var(--lm-border)" }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      overviewScrollRef.current = window.scrollY;
                      setView({ type: "all" });
                      window.scrollTo(0, 0);
                    }}
                    className="flex items-center gap-2 rounded-full border px-5 py-2.5 text-[12px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                    style={{
                      borderColor: "var(--lm-border-strong)",
                      color: "var(--lm-text-secondary)",
                    }}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    Browse all {totalAssets} assets
                  </button>
                </div>
              )}
            </>
          ) : visibleAssets.length === 0 ? (
            <p
              className="py-24 text-center text-[13px]"
              style={{ color: "var(--lm-text-tertiary)" }}
            >
              Nothing here for this filter yet.
            </p>
          ) : (
            <div
              className="relative"
              style={{ height: layout.totalHeight }}
              role="list"
              aria-label="Board assets"
            >
              {layout.tiles.map((tile) => {
                const asset = visibleAssets[tile.index]!;
                return (
                  <BoardTile
                    key={asset.id}
                    asset={asset}
                    token={token}
                    eager={tile.index < 8}
                    style={{
                      position: "absolute",
                      top: tile.top,
                      left: tile.left,
                      width: tile.width,
                      height: tile.height,
                    }}
                    showCollectionLabel={view.type === "all"}
                    onOpen={() => setFocusId(asset.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ── Lightbox ── */}
      {focusAsset && (
        <Lightbox
          asset={focusAsset}
          token={token}
          index={focusIndex}
          total={visibleAssets.length}
          onClose={() => setFocusId(null)}
          onPrev={() => goFocus(-1)}
          onNext={() => goFocus(1)}
          filmstrip={visibleAssets}
          filmstripRef={filmstripRef}
          activeThumbRef={activeThumbRef}
          onPick={(id) => setFocusId(id)}
        />
      )}
    </div>
  );
}

/* ── Overview section pieces ── */

function SectionHeader({
  label,
  count,
  blurb,
}: {
  label: string;
  count: number;
  blurb: string;
}) {
  return (
    <div
      className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b pb-3"
      style={{ borderColor: "var(--lm-border)" }}
    >
      <h2
        className="text-2xl md:text-3xl"
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          color: "var(--lm-text-primary)",
        }}
      >
        {label}
      </h2>
      <span
        className="text-[11px] font-mono font-bold uppercase tracking-wider"
        style={{ color: "var(--lm-coral)" }}
      >
        {count} {count === 1 ? "direction" : "directions"}
      </span>
      <span
        className="text-[12px]"
        style={{ color: "var(--lm-text-tertiary)" }}
      >
        {blurb}
      </span>
    </div>
  );
}

/** Justified rows of direction stacks for one section. */
function DirectionGrid({
  directions,
  gridWidth,
  isBeats,
  onOpen,
}: {
  directions: BoardDirection[];
  gridWidth: number;
  isBeats: boolean;
  onOpen: (id: string) => void;
}) {
  const cardLayout = useMemo(() => {
    const targetRowHeight = Math.max(
      240,
      Math.min(400, Math.round(gridWidth / 3.4)),
    );
    return layoutJustified(
      directions.map((direction) => ({
        width: direction.cover?.width,
        height: direction.cover?.height,
        kind: direction.cover?.kind ?? "image",
        contentType: direction.cover?.contentType,
      })),
      { containerWidth: gridWidth, gap: DEFAULT_GAP_PX, targetRowHeight },
    );
  }, [directions, gridWidth]);

  return (
    <div
      className="relative"
      style={{ height: cardLayout.totalHeight }}
      role="list"
      aria-label="Directions"
    >
      {cardLayout.tiles.map((tile) => {
        const direction = directions[tile.index]!;
        return (
          <DirectionCardTile
            key={direction.id}
            direction={direction}
            isBeat={isBeats}
            eager={tile.index < 6}
            style={{
              position: "absolute",
              top: tile.top,
              left: tile.left,
              width: tile.width,
              height: tile.height,
            }}
            onOpen={() => onOpen(direction.id)}
            onOpenDirection={onOpen}
          />
        );
      })}
    </div>
  );
}

/* ── Download ── */

// R2's public domain has no CORS headers, so the board downloads through the
// same-origin proxy route, which re-validates the share token and streams the
// file with a Content-Disposition attachment header.
function triggerDownload(token: string, assetId: string) {
  const anchor = document.createElement("a");
  anchor.href = `/api/board/download?token=${encodeURIComponent(
    token,
  )}&assetId=${encodeURIComponent(assetId)}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function DownloadButton({
  token,
  assetId,
  size = "sm",
}: {
  token: string;
  assetId: string;
  size?: "sm" | "lg";
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        triggerDownload(token, assetId);
      }}
      className={`flex items-center gap-1.5 rounded-lg border font-mono font-bold uppercase tracking-wider transition-all active:scale-95 ${
        size === "lg" ? "px-3 py-2 text-[12px]" : "px-2 py-1 text-[10px]"
      }`}
      style={{
        backgroundColor: "rgba(0,0,0,0.62)",
        color: "#fff",
        borderColor: "rgba(255,255,255,0.25)",
      }}
      title="Download"
    >
      <Download className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} />
      Save
    </button>
  );
}

/* ── Direction card: a set of similar options, thumbed by its master ── */

function DirectionCardTile({
  direction,
  isBeat = false,
  eager,
  style,
  onOpen,
  onOpenDirection,
}: {
  direction: BoardDirection;
  /** Beat cards carry the character + location pairing chips. */
  isBeat?: boolean;
  eager: boolean;
  style: React.CSSProperties;
  onOpen: () => void;
  onOpenDirection?: (id: string) => void;
}) {
  const cover = direction.cover;
  // Hover 1s → rotate through the direction's options in place.
  const preview = useStackHoverPreview(direction.previews.length);
  const pairs = [direction.pairCharacter, direction.pairLocation].filter(
    (pair): pair is PairRef => Boolean(pair),
  );
  return (
    <div
      className="group relative cursor-pointer"
      style={style}
      role="listitem"
      onClick={onOpen}
      onMouseEnter={preview.start}
      onMouseLeave={preview.stop}
      aria-label={`Open direction: ${direction.name}`}
    >
      {/* Fanned deck — next variations peeking behind the master */}
      {direction.backs.map((src, index) => (
        <div
          key={`${direction.id}-back-${index}`}
          className="absolute inset-0 overflow-hidden rounded-xl transition-transform duration-200 ease-out"
          style={{
            border: "1px solid var(--lm-border)",
            backgroundColor: "var(--lm-surface-2)",
            transform:
              index === 0
                ? "rotate(-2deg) translate(-6px, 5px) scale(0.985)"
                : "rotate(2.6deg) translate(7px, 7px) scale(0.97)",
            zIndex: index === 0 ? 2 : 1,
          }}
        >
          <img
            src={src}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
            style={{ opacity: 0.85 }}
            loading="lazy"
          />
        </div>
      ))}

      {/* Master on top */}
      <div
        className="absolute inset-0 z-[3] overflow-hidden rounded-xl transition-transform duration-200 ease-out group-hover:-translate-y-[3px]"
        style={{
          border: "2px solid var(--lm-border-strong)",
          backgroundColor: "var(--lm-surface-1)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
        }}
      >
        {cover ? (
          <Media asset={cover} variant="tile" eager={eager} />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-[11px] font-mono uppercase tracking-wider"
            style={{
              backgroundColor: "var(--lm-surface-2)",
              color: "var(--lm-text-ghost)",
            }}
          >
            Empty
          </div>
        )}

        <StackHoverPreviewOverlay
          previews={direction.previews}
          index={preview.index}
          engaged={preview.engaged}
        />

        {/* Option count badge — turns into a n/N counter while previewing */}
        <span
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
          style={{
            backgroundColor: "rgba(0,0,0,0.62)",
            color: "var(--lm-coral)",
            border:
              "1px solid color-mix(in srgb, var(--lm-coral) 42%, transparent)",
          }}
        >
          {preview.engaged
            ? `${(preview.index % direction.previews.length) + 1}/${direction.previews.length}`
            : direction.count}
        </span>

        {/* Beat pairing chips — the character + location this beat combines */}
        {isBeat && pairs.length > 0 && (
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
            {pairs.map((pair, index) => (
              <span key={pair.id} className="flex items-center gap-1">
                {index > 0 && (
                  <Plus
                    className="h-3 w-3"
                    style={{ color: "rgba(255,255,255,0.8)" }}
                    strokeWidth={3}
                  />
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDirection?.(pair.id);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border p-0.5 pr-2 transition-transform hover:scale-105"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.62)",
                    borderColor: "rgba(255,255,255,0.25)",
                  }}
                  title={`Open direction: ${pair.name}`}
                >
                  {pair.thumb ? (
                    <img
                      src={pair.thumb}
                      alt=""
                      className="h-6 w-6 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      className="h-6 w-6 rounded-md"
                      style={{ backgroundColor: "var(--lm-surface-3)" }}
                    />
                  )}
                  <span
                    className="max-w-[9ch] truncate text-[9px] font-mono font-bold uppercase tracking-wider"
                    style={{ color: "#fff" }}
                  >
                    {pair.name}
                  </span>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Bottom label over a gradient so any master image stays readable */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.74), rgba(0,0,0,0.28) 60%, transparent)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
          <div className="min-w-0">
            <p
              className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
              style={{ color: "var(--lm-coral)" }}
            >
              {isBeat ? "Storybeat" : "Direction"}
            </p>
            <p
              className="truncate text-[15px] font-semibold"
              style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}
            >
              {direction.name}
            </p>
            <p
              className="text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{ color: "rgba(255,255,255,0.68)" }}
            >
              {direction.count} {direction.count === 1 ? "option" : "options"}
            </p>
          </div>
          <span
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
          >
            Explore
            <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Grid tile ── */

function BoardTile({
  asset,
  token,
  eager,
  style,
  showCollectionLabel,
  onOpen,
}: {
  asset: BoardAsset;
  token: string;
  eager: boolean;
  style: React.CSSProperties;
  showCollectionLabel: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl"
      style={{
        ...style,
        border: asset.approved
          ? "2px solid var(--lm-coral)"
          : "1px solid var(--lm-border)",
        backgroundColor: "var(--lm-surface-1)",
      }}
      role="listitem"
      onClick={onOpen}
    >
      <div className="relative h-full w-full">
        <Media asset={asset} variant="tile" eager={eager} />

        <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <DownloadButton token={token} assetId={asset.id} />
        </div>

        {asset.approved && (
          <span
            className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--lm-coral)" }}
            title="Approved"
          >
            <Check className="h-3 w-3" strokeWidth={3} color="#000" />
          </span>
        )}

        {showCollectionLabel && (
          <span
            className="absolute bottom-2 left-2 z-10 rounded-md px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: "rgba(0,0,0,0.62)", color: "#fff" }}
          >
            {asset.collectionName}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Lightbox: hero + filmstrip ── */

function Lightbox({
  asset,
  token,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  filmstrip,
  filmstripRef,
  activeThumbRef,
  onPick,
}: {
  asset: BoardAsset;
  token: string;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  filmstrip: BoardAsset[];
  filmstripRef: React.RefObject<HTMLDivElement | null>;
  activeThumbRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (id: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col lm-animate-fade-in"
      style={{
        backgroundColor: "rgba(8,7,6,0.985)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={asset.title ?? asset.collectionName}
    >
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <span
          className="truncate text-[12px] font-mono uppercase tracking-wider"
          style={{ color: "var(--lm-text-tertiary)" }}
        >
          {asset.collectionName}
          {asset.title ? ` — ${asset.title}` : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border transition-opacity hover:opacity-80"
          style={{
            borderColor: "var(--lm-border-strong)",
            color: "var(--lm-text-secondary)",
          }}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center p-3 md:p-6">
          <Media asset={asset} variant="hero" />
        </div>

        {index > 0 && <HeroArrow side="left" onClick={onPrev} />}
        {index < total - 1 && <HeroArrow side="right" onClick={onNext} />}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 md:p-6">
          <div className="pointer-events-auto flex items-center gap-2">
            {asset.approved && (
              <span
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider"
                style={{ backgroundColor: "var(--lm-coral)", color: "#000" }}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
                Approved
              </span>
            )}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <span
              className="text-[11px] font-mono"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              {index + 1}/{total}
            </span>
            <DownloadButton token={token} assetId={asset.id} size="lg" />
          </div>
        </div>
      </div>

      <div
        ref={filmstripRef}
        className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 py-3"
        style={{
          borderTop: "1px solid var(--lm-border-strong)",
          scrollbarWidth: "thin",
        }}
      >
        {filmstrip.map((item) => {
          const active = item.id === asset.id;
          return (
            <button
              key={item.id}
              ref={active ? activeThumbRef : undefined}
              type="button"
              onClick={() => onPick(item.id)}
              className="relative h-20 shrink-0 overflow-hidden rounded-lg transition-all md:h-24"
              style={{
                aspectRatio:
                  item.width && item.height
                    ? `${item.width} / ${item.height}`
                    : "1 / 1",
                outline: active
                  ? "2px solid var(--lm-coral)"
                  : "1px solid var(--lm-border)",
                opacity: active ? 1 : 0.62,
              }}
              title={item.collectionName}
            >
              <Media asset={item} variant="thumb" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HeroArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border transition-opacity hover:opacity-100 ${
        side === "left" ? "left-3" : "right-3"
      }`}
      style={{
        backgroundColor: "rgba(0,0,0,0.55)",
        borderColor: "rgba(255,255,255,0.2)",
        color: "#fff",
        opacity: 0.7,
      }}
      aria-label={side === "left" ? "Previous" : "Next"}
    >
      {side === "left" ? (
        <ChevronLeft className="h-6 w-6" />
      ) : (
        <ChevronRight className="h-6 w-6" />
      )}
    </button>
  );
}

/* ── Media renderer (raw img/video, like review-modal) ── */

function Media({
  asset,
  variant,
  eager = false,
}: {
  asset: BoardAsset;
  variant: "tile" | "hero" | "thumb";
  eager?: boolean;
}) {
  const isVideo = asset.kind === "video";
  const src =
    variant === "hero"
      ? asset.url ?? asset.thumbUrl
      : asset.thumbUrl ?? asset.url;

  if (variant === "hero") {
    if (isVideo) {
      return (
        <div className="relative flex max-h-full max-w-full items-center justify-center">
          <video
            src={asset.url}
            poster={asset.thumbUrl}
            controls
            muted
            loop
            playsInline
            preload="metadata"
            className="max-h-full max-w-full object-contain"
            style={{ maxHeight: "78vh" }}
          />
        </div>
      );
    }
    return (
      <img
        src={src}
        alt={asset.title ?? asset.collectionName}
        className="max-h-full max-w-full object-contain"
        style={{ maxHeight: "82vh" }}
      />
    );
  }

  if (isVideo) {
    return (
      <>
        <video
          src={asset.thumbUrl ? undefined : asset.url}
          poster={asset.thumbUrl}
          muted
          playsInline
          preload={asset.thumbUrl ? "none" : "metadata"}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <Play className="ml-0.5 h-4 w-4" fill="#fff" color="#fff" />
        </span>
      </>
    );
  }
  return (
    <img
      src={src}
      alt={asset.title ?? asset.collectionName}
      loading={eager ? "eager" : "lazy"}
      className={`absolute inset-0 h-full w-full object-cover ${
        variant === "tile"
          ? "transition-transform duration-200 group-hover:scale-[1.02]"
          : ""
      }`}
    />
  );
}
