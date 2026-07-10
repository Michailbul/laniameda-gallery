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
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Play,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DEFAULT_GAP_PX, layoutJustified } from "@/lib/masonry-layout";

const ALL = "__all__";

type TypeFilter = "all" | "image" | "video";

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

/**
 * Public, read-only direction board for a shared project. A colleague opens
 * /b/<token> with no account and can browse the project's collections
 * (characters, locations, stories…), filter by section / stills / videos /
 * approved, view everything large, and download assets.
 */
export function DirectionBoard({ token }: { token: string }) {
  const board = useQuery(api.directionBoard.getBoard, { token });

  const [activeCollection, setActiveCollection] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

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

  // Flatten collections → assets. "All" dedupes across collections (first
  // collection wins the label); a specific collection keeps only its own.
  const assets = useMemo<BoardAsset[]>(() => {
    if (!board) return [];
    const out: BoardAsset[] = [];
    const seen = new Set<string>();
    for (const collection of board.collections) {
      for (const asset of collection.assets) {
        const id = asset.id as string;
        if (activeCollection === ALL) {
          if (seen.has(id)) continue;
          seen.add(id);
        } else if ((collection.id as string) !== activeCollection) {
          continue;
        }
        out.push({
          id,
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
        });
      }
    }
    return out;
  }, [board, activeCollection]);

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
      if (!focusId) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setFocusId(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goFocus(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goFocus(1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [focusId, goFocus]);

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
    if (!board) return 0;
    const seen = new Set<string>();
    for (const collection of board.collections) {
      for (const asset of collection.assets) seen.add(asset.id as string);
    }
    return seen.size;
  }, [board]);

  const chips = [
    { id: ALL, name: "All", count: undefined as number | undefined },
    ...(board?.collections ?? []).map((collection) => ({
      id: collection.id as string,
      name: collection.name,
      count: collection.count as number | undefined,
    })),
  ];

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

        {!isLoading && !notFound && (
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
              {board.collections.length}{" "}
              {board.collections.length === 1 ? "section" : "sections"} ·{" "}
              {totalAssets} assets
              {board.updatedAt
                ? ` · updated ${new Date(board.updatedAt).toLocaleDateString()}`
                : ""}
            </p>
          </div>
        )}
      </header>

      {/* ── Filters ── */}
      {!isLoading && !notFound && board.collections.length > 0 && (
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
            {chips.map((chip) => {
              const active = activeCollection === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setActiveCollection(chip.id)}
                  className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                  style={{
                    borderColor: active
                      ? "var(--lm-coral)"
                      : "var(--lm-border-strong)",
                    backgroundColor: active
                      ? "color-mix(in srgb, var(--lm-coral) 16%, transparent)"
                      : "transparent",
                    color: active
                      ? "var(--lm-coral)"
                      : "var(--lm-text-secondary)",
                  }}
                >
                  {chip.name}
                  {chip.count !== undefined && (
                    <span style={{ opacity: 0.6 }}> {chip.count}</span>
                  )}
                </button>
              );
            })}

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
          </div>
        </div>
      )}

      {/* ── Grid ── */}
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
                    showCollectionLabel={activeCollection === ALL}
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
