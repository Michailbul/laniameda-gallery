"use client";

import { memo, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Package } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SkeletonGrid } from "@/components/ui/coral-skeleton";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import type { Pillar } from "./filter-bar";

/* ── Types ── */

type PackWithCover = {
  _id: Id<"assetPacks">;
  title: string;
  description?: string;
  pillar?: string;
  modelName?: string;
  itemCount?: number;
  isPublic?: boolean;
  isFeatured?: boolean;
  createdAt: number;
  updatedAt: number;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  coverWidth?: number;
  coverHeight?: number;
  previewUrls: string[];
  hasWorkflowAssets: boolean;
};

type PackGridProps = {
  ownerUserId: string;
  selectedPillar: Pillar | null;
  selectedTagIds?: Id<"tags">[];
  selectedModelName?: string | null;
  onPackSelect: (packId: string) => void;
};

/* ── Pack Card ── */

const PILLAR_COLORS: Record<string, string> = {
  creators: "var(--v7-pillar-creators)",
  cars: "var(--v7-pillar-cars)",
  designs: "var(--v7-pillar-designs)",
  dump: "var(--v7-pillar-dump)",
};

const PackCard = memo(function PackCard({
  pack,
  onClick,
  index,
}: {
  pack: PackWithCover;
  onClick: () => void;
  index: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [copiedId, setCopiedId] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const coralCtx = useCoralToastSafe();
  const toastFn = coralCtx?.toast;
  const coverSrc = pack.coverThumbUrl ?? pack.coverUrl;
  const accentColor = PILLAR_COLORS[pack.pillar ?? "creators"] ?? "var(--v7-coral)";
  const itemCount = pack.itemCount ?? 0;
  const isWorkflow = pack.hasWorkflowAssets;
  // Slides: dedup cover + previews, cap at 10.
  const slides = buildSlides(coverSrc, pack.previewUrls).slice(0, 10);
  const hasCarousel = slides.length > 1;
  // Preserve hero image aspect ratio — clamped loosely so 16:9 packs look wide.
  const rawRatio =
    pack.coverWidth && pack.coverHeight ? pack.coverWidth / pack.coverHeight : 4 / 5;
  const heroRatio = clamp(rawRatio, 0.62, 1.78);

  const scrollToSlide = (nextIdx: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const clamped = Math.max(0, Math.min(slides.length - 1, nextIdx));
    scroller.scrollTo({ left: clamped * scroller.clientWidth, behavior: "smooth" });
    setActiveSlide(clamped);
  };

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientWidth === 0) return;
    const idx = Math.round(scroller.scrollLeft / scroller.clientWidth);
    if (idx !== activeSlide) setActiveSlide(idx);
  };

  const handleCopyPackId = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(`pack:${pack._id}`).then(() => {
      setCopiedId(true);
      toastFn?.("Copied", "PACK ID COPIED", "success");
      window.setTimeout(() => setCopiedId(false), 1500);
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--v7-coral)]"
      style={{
        borderRadius: "16px",
        overflow: "hidden",
        border: "2px solid var(--v7-border)",
        background: "var(--v7-surface-1)",
        boxShadow: hovered
          ? `0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px ${accentColor}44`
          : "0 2px 8px rgba(0,0,0,0.04)",
        transition: "box-shadow 250ms ease, transform 250ms ease, border-color 250ms ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        borderColor: hovered ? accentColor : "var(--v7-border)",
        animationDelay: `${index * 60}ms`,
        animation: "pack-card-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
      }}
      aria-label={`Pack: ${pack.title}, ${itemCount} items`}
    >
      {/* Cover carousel — preserves hero aspect ratio */}
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: coverSrc ? `${heroRatio}` : "4 / 3",
          backgroundColor: "var(--v7-surface-3)",
        }}
      >
        {coverSrc ? (
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="pack-card-scroller flex h-full w-full overflow-x-auto overflow-y-hidden"
            style={{ scrollbarWidth: "none", scrollSnapType: "x proximity" }}
          >
            {slides.map((url, i) => (
              <div
                key={`${url}-${i}`}
                className="relative h-full w-full shrink-0 snap-center"
              >
                <Image
                  src={url}
                  alt={i === 0 ? pack.title : `${pack.title} — variation ${i + 1}`}
                  fill
                  sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                  className="object-cover"
                  style={{
                    transition: "transform 600ms ease",
                    transform: hovered && activeSlide === i ? "scale(1.03)" : "scale(1)",
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package
              className="h-8 w-8"
              style={{ color: "var(--v7-text-ghost)", opacity: 0.4 }}
            />
          </div>
        )}

        {/* Bottom gradient overlay */}
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            height: "60%",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
            pointerEvents: "none",
          }}
        />

        {/* Top row — workflow badge + count */}
        <div className="absolute inset-x-2.5 top-2.5 flex items-center justify-between gap-2 pointer-events-none">
          {isWorkflow ? (
            <div
              className="flex items-center gap-1 px-2 py-[3px]"
              style={{
                background: "rgba(255,255,255,0.92)",
                borderRadius: "7px",
                border: "1px solid rgba(0,0,0,0.08)",
                fontFamily: "var(--v7-font)",
                fontSize: "8.5px",
                fontWeight: 900,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--v7-ink)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.16)",
              }}
            >
              <span
                style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  backgroundColor: accentColor,
                }}
              />
              Workflow
            </div>
          ) : (
            <span />
          )}
          <div
            className="flex items-center gap-1 px-2 py-0.5"
            style={{
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: "10px",
              fontWeight: 800,
              fontFamily: "var(--v7-font)",
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.9)",
            }}
          >
            <Package className="h-2.5 w-2.5" />
            {hasCarousel ? `${activeSlide + 1} / ${slides.length}` : itemCount}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopyPackId}
          className="absolute left-2.5 top-10 z-20 flex items-center justify-center transition-all"
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "8px",
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: copiedId ? "var(--v7-success)" : "#fff",
            opacity: hovered || copiedId ? 1 : 0,
            transform: `scale(${hovered || copiedId ? 1 : 0.9})`,
            pointerEvents: hovered || copiedId ? "auto" : "none",
          }}
          aria-label="Copy pack ID"
          title="Copy pack ID"
        >
          {copiedId ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>

        {/* Prev / next arrows — on hover, when carousel available */}
        {hasCarousel && (
          <>
            <CarouselArrow
              side="left"
              visible={hovered && activeSlide > 0}
              onClick={(e) => {
                e.stopPropagation();
                scrollToSlide(activeSlide - 1);
              }}
            />
            <CarouselArrow
              side="right"
              visible={hovered && activeSlide < slides.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                scrollToSlide(activeSlide + 1);
              }}
            />
            {/* Dot indicators */}
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1"
              style={{
                bottom: "10px",
                opacity: hovered ? 1 : 0,
                transition: "opacity 200ms ease",
                pointerEvents: "none",
              }}
            >
              {slides.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === activeSlide ? "14px" : "5px",
                    height: "5px",
                    borderRadius: "3px",
                    backgroundColor:
                      i === activeSlide ? "#fff" : "rgba(255,255,255,0.45)",
                    transition: "width 200ms ease, background-color 200ms ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  }}
                />
              ))}
            </div>
          </>
        )}

        {/* Title overlay */}
        <div
          className="absolute inset-x-0 bottom-0 px-3.5 pb-3"
          style={{
            pointerEvents: "none",
            opacity: hovered && hasCarousel ? 0 : 1,
            transition: "opacity 180ms ease",
          }}
        >
          <h3
            style={{
              fontFamily: "var(--v7-font)",
              fontSize: "12px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.10em",
              color: "#fff",
              lineHeight: 1.3,
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {pack.title}
          </h3>
        </div>
      </div>

      {/* Meta bar */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5"
        style={{ borderTop: `1px solid var(--v7-border)` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {pack.pillar && (
            <span
              className="shrink-0"
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: accentColor,
              }}
            />
          )}
          {pack.modelName && (
            <span
              style={{
                fontFamily: "var(--v7-font)",
                fontSize: "9px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.10em",
                color: "var(--v7-text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {pack.modelName}
            </span>
          )}
        </div>
        <span
          style={{
            fontFamily: "var(--v7-font)",
            fontSize: "9px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--v7-text-ghost)",
          }}
        >
          {new Date(pack.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </div>
  );
});

function CarouselArrow({
  side,
  visible,
  onClick,
}: {
  side: "left" | "right";
  visible: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous variation" : "Next variation"}
      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center"
      style={{
        [side]: "8px",
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "#fff",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        transform: `translateY(-50%) scale(${visible ? 1 : 0.85})`,
        transition: "opacity 180ms ease, transform 180ms ease",
        pointerEvents: visible ? "auto" : "none",
        boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
      }}
    >
      {side === "left" ? (
        <ChevronLeft className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
    </button>
  );
}

function buildSlides(
  coverSrc: string | null | undefined,
  previewUrls: string[],
): string[] {
  const slides: string[] = [];
  const seen = new Set<string>();
  const push = (url?: string | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    slides.push(url);
  };
  push(coverSrc);
  for (const url of previewUrls) push(url);
  return slides;
}

/* ── Pack Detail View (shown when a pack is selected) ── */

type PackDetailViewProps = {
  packId: string;
  selectedAssetId?: string;
  compact?: boolean;
  onBack: () => void;
  onAssetSelect: (asset: {
    id: string;
    packId: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    modelName?: string;
    pillar?: string;
    tagNames?: string[];
    sourceUrl?: string;
    createdAt?: number;
    previewImages: Array<{
      id: string;
      src: string;
      fullSrc: string;
      prompt: string;
      width?: number;
      height?: number;
    }>;
  }) => void;
};

function PackDetailView({ packId, selectedAssetId, compact, onBack, onAssetSelect }: PackDetailViewProps) {
  const hasSelection = Boolean(selectedAssetId);
  const packData = useQuery(
    api.assetPacks.getAssetPackWithAssets,
    { packId: packId as Id<"assetPacks"> },
  );

  if (packData === undefined) {
    return (
      <div style={{ padding: "12px" }}>
        <PackDetailHeader title="Loading..." onBack={onBack} />
        <SkeletonGrid columnClasses="columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5" />
      </div>
    );
  }

  if (packData === null) {
    return (
      <div style={{ padding: "12px" }}>
        <PackDetailHeader title="Pack not found" onBack={onBack} />
        <div className="flex flex-col items-center justify-center py-20">
          <Package className="h-10 w-10 mb-3" style={{ color: "var(--v7-text-ghost)" }} />
          <p style={{
            fontFamily: "var(--v7-font)",
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--v7-text-tertiary)",
          }}>
            This pack may have been deleted.
          </p>
        </div>
      </div>
    );
  }

  const { pack, items } = packData;
  const accentColor = PILLAR_COLORS[pack.pillar ?? "creators"] ?? "var(--v7-coral)";

  // Build preview images array for all items in the pack
  const allPreviews = items.map((item) => ({
    id: item.asset._id,
    src: item.thumbUrl ?? item.assetUrl ?? "/placeholder.svg",
    fullSrc: item.assetUrl ?? "/placeholder.svg",
    prompt: item.promptText ?? item.asset.fileName ?? "Untitled",
    width: item.asset.thumbWidth ?? item.asset.width,
    height: item.asset.thumbHeight ?? item.asset.height,
  }));

  return (
    <div
      style={{ animation: "pack-detail-enter 350ms cubic-bezier(0.16, 1, 0.3, 1) backwards" }}
    >
      <div style={{ padding: "12px 12px 0" }}>
        <PackDetailHeader title={pack.title} onBack={onBack} itemCount={items.length} accentColor={accentColor} />

        {/* Pack meta strip */}
        {(pack.description || pack.modelName) && (
          <div
            className="mt-2 mb-3 px-1"
            style={{
              fontFamily: "var(--v7-font)",
              fontSize: "11px",
              color: "var(--v7-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {pack.description && (
              <p style={{ marginBottom: pack.modelName ? "4px" : 0 }}>{pack.description}</p>
            )}
            {pack.modelName && (
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--v7-text-ghost)",
                }}
              >
                {pack.modelName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Asset grid — layout adapts to item count for better presence */}
      <PackAssetLayout
        items={items}
        pack={pack}
        compact={Boolean(compact)}
        selectedAssetId={selectedAssetId}
        hasSelection={hasSelection}
        accentColor={accentColor}
        allPreviews={allPreviews}
        onAssetSelect={onAssetSelect}
      />
    </div>
  );
}

type PackItem = {
  asset: {
    _id: string;
    fileName?: string;
    width?: number;
    height?: number;
    thumbWidth?: number;
    thumbHeight?: number;
    modelName?: string;
    pillar?: string;
    sourceUrl?: string;
    createdAt?: number;
    packSlotIndex?: number;
  };
  thumbUrl?: string | null;
  assetUrl?: string | null;
  promptText?: string | null;
};

type PackAssetLayoutProps = {
  items: PackItem[];
  pack: { _id: string; pillar?: string };
  compact: boolean;
  selectedAssetId?: string;
  hasSelection: boolean;
  accentColor: string;
  allPreviews: Array<{
    id: string;
    src: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  }>;
  onAssetSelect: PackDetailViewProps["onAssetSelect"];
};

function PackAssetLayout({
  items,
  pack,
  compact,
  selectedAssetId,
  hasSelection,
  accentColor,
  allPreviews,
  onAssetSelect,
}: PackAssetLayoutProps) {
  const columnCount = usePackLayoutColumnCount(items.length, compact);

  const buildCardProps = (item: PackItem, originalIndex: number) => {
    const thumbSrc = item.thumbUrl ?? item.assetUrl ?? "/placeholder.svg";
    const fullSrc = item.assetUrl ?? "/placeholder.svg";
    const prompt = item.promptText ?? item.asset.fileName ?? "Untitled";
    const isSelected = selectedAssetId === item.asset._id;
    return {
      cardKey: item.asset._id,
      cardProps: {
        assetId: item.asset._id,
        thumbSrc,
        fullSrc,
        prompt,
        width: item.asset.thumbWidth ?? item.asset.width,
        height: item.asset.thumbHeight ?? item.asset.height,
        slotIndex: item.asset.packSlotIndex ?? originalIndex,
        modelName: item.asset.modelName,
        pillar: item.asset.pillar,
        accentColor,
        index: originalIndex,
        isSelected,
        isDimmed: hasSelection && !isSelected,
        onClick: () =>
          onAssetSelect({
            id: item.asset._id,
            packId: pack._id,
            thumbSrc,
            fullSrc,
            prompt,
            width: item.asset.width,
            height: item.asset.height,
            modelName: item.asset.modelName,
            pillar: item.asset.pillar,
            sourceUrl: item.asset.sourceUrl,
            createdAt: item.asset.createdAt,
            previewImages: allPreviews,
          }),
      },
    };
  };

  // Single item — centered hero with a sensible max width.
  if (items.length === 1) {
    const { cardKey, cardProps } = buildCardProps(items[0], 0);
    return (
      <div
        style={{
          padding: "8px 12px 16px",
          maxWidth: compact ? "420px" : "620px",
          margin: "0 auto",
        }}
      >
        <PackAssetCard key={cardKey} {...cardProps} />
      </div>
    );
  }

  // Everything else — column-based masonry so mixed aspect ratios flow
  // naturally without synthetic whitespace next to short landscapes.
  const effectiveColumnCount = Math.min(columnCount, items.length);
  return (
    <div
      className="flex"
      style={{ gap: "12px", padding: "8px 12px 16px" }}
    >
      {distributeColumns(items, effectiveColumnCount).map((col, colIdx) => (
        <div key={colIdx} className="flex flex-1 flex-col" style={{ gap: "12px" }}>
          {col.map((item, rowIdx) => {
            const originalIndex = rowIdx * effectiveColumnCount + colIdx;
            const { cardKey, cardProps } = buildCardProps(item, originalIndex);
            return <PackAssetCard key={cardKey} {...cardProps} />;
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Sub-components ── */

function PackDetailHeader({
  title,
  onBack,
  itemCount,
  accentColor,
}: {
  title: string;
  onBack: () => void;
  itemCount?: number;
  accentColor?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center justify-center shrink-0 transition-colors"
        style={{
          width: "34px",
          height: "34px",
          borderRadius: "10px",
          border: "2px solid var(--v7-border-strong)",
          color: "var(--v7-text-secondary)",
          backgroundColor: "var(--v7-surface-1)",
        }}
        aria-label="Back to packs"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <h2
          style={{
            fontFamily: "var(--v7-font)",
            fontSize: "14px",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--v7-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </h2>
        {itemCount !== undefined && (
          <span
            style={{
              fontFamily: "var(--v7-font)",
              fontSize: "9px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: accentColor ?? "var(--v7-text-ghost)",
            }}
          >
            {itemCount} {itemCount === 1 ? "ASSET" : "ASSETS"}
          </span>
        )}
      </div>
    </div>
  );
}

const PackAssetCard = memo(function PackAssetCard({
  assetId,
  thumbSrc,
  prompt,
  width,
  height,
  slotIndex,
  accentColor,
  index,
  isSelected,
  isDimmed,
  onClick,
}: {
  assetId: string;
  thumbSrc: string;
  fullSrc: string;
  prompt: string;
  width?: number;
  height?: number;
  slotIndex: number;
  modelName?: string;
  pillar?: string;
  accentColor: string;
  index: number;
  isSelected?: boolean;
  isDimmed?: boolean;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const coralCtx = useCoralToastSafe();
  const toastFn = coralCtx?.toast;
  // Lock entrance-animation delay to initial position so column re-layouts
  // (e.g. when inspector opens) don't re-trigger the stagger.
  const [initialIndex] = useState(index);
  const aspectRatio = width && height ? width / height : undefined;

  // Selected > hovered > dimmed > default
  const borderStyle = isSelected
    ? `3px solid ${accentColor}`
    : hovered
      ? `2px solid ${accentColor}99`
      : "2px solid var(--v7-border)";

  const shadowStyle = isSelected
    ? `0 12px 36px ${accentColor}40, 0 0 0 2px ${accentColor}55, 0 2px 8px rgba(0,0,0,0.08)`
    : hovered
      ? `0 8px 28px rgba(0,0,0,0.10), 0 0 0 1px ${accentColor}33`
      : "0 2px 6px rgba(0,0,0,0.03)";

  const cardOpacity = isDimmed && !hovered ? 0.68 : 1;
  const cardScale = isSelected ? 1.015 : 1;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  const handleCopyAssetId = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(`asset:${assetId}`).then(() => {
      setCopiedId(true);
      toastFn?.("Copied", "ASSET ID COPIED", "success");
      window.setTimeout(() => setCopiedId(false), 1500);
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--v7-coral)]"
      aria-pressed={isSelected}
      style={{
        borderRadius: "12px",
        overflow: "hidden",
        border: borderStyle,
        background: "var(--v7-surface-1)",
        boxShadow: shadowStyle,
        opacity: cardOpacity,
        transform: `scale(${cardScale})`,
        transition: "all 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        animation: `pack-asset-enter 300ms cubic-bezier(0.16, 1, 0.3, 1) ${initialIndex * 40}ms backwards`,
      }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: aspectRatio ? `${aspectRatio}` : "1",
          backgroundColor: "var(--v7-surface-3)",
        }}
      >
        <Image
          src={thumbSrc}
          alt={prompt}
          fill
          sizes="(min-width: 1280px) 20vw, (min-width: 768px) 25vw, 50vw"
          className="object-cover"
          style={{
            opacity: loaded ? 1 : 0,
            transition: "opacity 300ms ease, transform 500ms ease",
            transform: hovered || isSelected ? "scale(1.03)" : "scale(1)",
          }}
          onLoad={() => setLoaded(true)}
        />

        {/* Slot / focus badge — top left */}
        {isSelected ? (
          <div
            className="absolute left-2 top-2 flex items-center gap-1 px-2 py-[3px]"
            style={{
              borderRadius: "7px",
              backgroundColor: accentColor,
              color: "#fff",
              fontFamily: "var(--v7-font)",
              fontSize: "8.5px",
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              boxShadow: "0 2px 6px rgba(0,0,0,0.20)",
            }}
          >
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: "#fff",
              }}
            />
            Focused
          </div>
        ) : (
          <div
            className="absolute left-2 top-2"
            style={{
              width: "22px",
              height: "22px",
              borderRadius: "7px",
              backgroundColor: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--v7-font)",
              fontSize: "9px",
              fontWeight: 800,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {slotIndex + 1}
          </div>
        )}

        <button
          type="button"
          onClick={handleCopyAssetId}
          className="absolute right-2 top-2 z-20 flex items-center justify-center transition-all"
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: copiedId ? "var(--v7-success)" : "#fff",
            opacity: hovered || copiedId ? 1 : 0,
            transform: `scale(${hovered || copiedId ? 1 : 0.9})`,
            pointerEvents: hovered || copiedId ? "auto" : "none",
          }}
          aria-label="Copy asset ID"
          title="Copy asset ID"
        >
          {copiedId ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>

        {/* Hover prompt overlay */}
        <div
          className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-6"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)",
            opacity: hovered || isSelected ? 1 : 0,
            transition: "opacity 200ms ease",
            pointerEvents: "none",
          }}
        >
          <p
            style={{
              fontFamily: "var(--v7-font)",
              fontSize: "9px",
              fontWeight: 500,
              color: "rgba(255,255,255,0.90)",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {prompt}
          </p>
        </div>
      </div>
    </div>
  );
});

/* ── Helpers ── */

function resolvePackColumnCount(itemCount: number, compact: boolean): number {
  if (typeof window === "undefined") return compact ? 2 : 3;
  const w = window.innerWidth;
  // Cap columns by item count so cards stay large when pack is small.
  const cap = Math.max(2, Math.min(itemCount, compact ? 3 : 4));
  let cols: number;
  if (compact) {
    if (w >= 1280) cols = 3;
    else if (w >= 768) cols = 2;
    else cols = 2;
  } else {
    if (w >= 1536) cols = 4;
    else if (w >= 1024) cols = 3;
    else if (w >= 768) cols = 3;
    else cols = 2;
  }
  return Math.min(cols, cap);
}

function usePackLayoutColumnCount(itemCount: number, compact: boolean): number {
  const [count, setCount] = useState(() => resolvePackColumnCount(itemCount, compact));
  useEffect(() => {
    const handler = () => setCount(resolvePackColumnCount(itemCount, compact));
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [compact, itemCount]);
  return count;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function distributeColumns<T>(items: T[], numColumns: number): T[][] {
  const columns: T[][] = Array.from({ length: numColumns }, () => []);
  for (let i = 0; i < items.length; i++) {
    columns[i % numColumns].push(items[i]);
  }
  return columns;
}

/* ── Main Export: PackGrid ── */

export function PackGrid({
  ownerUserId,
  selectedPillar,
  selectedTagIds,
  selectedModelName,
  onPackSelect,
}: PackGridProps) {
  const packs = useQuery(
    api.assetPacks.listAssetPacksWithCovers,
    {
      ownerUserId,
      pillar: selectedPillar ?? undefined,
      tagIds: selectedTagIds && selectedTagIds.length > 0 ? selectedTagIds : undefined,
      modelName: selectedModelName ?? undefined,
      limit: 60,
    },
  );

  if (packs === undefined) {
    return (
      <div style={{ padding: "12px" }}>
        <SkeletonGrid columnClasses="columns-2 sm:columns-2 md:columns-3 lg:columns-4" />
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-8 py-12 text-center v7-animate-fade-in">
        <div
          className="relative mb-6 h-16 w-16 flex items-center justify-center"
          style={{
            border: "3px solid var(--v7-ink)",
            backgroundColor: "var(--v7-accent-dim)",
            borderRadius: "16px",
            boxShadow: "0 0 20px rgba(255, 122, 100, 0.15)",
          }}
        >
          <Package className="h-6 w-6" style={{ color: "var(--v7-coral)" }} />
        </div>
        <h2
          style={{
            fontFamily: "var(--v7-font)",
            fontSize: "16px",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--v7-text-primary)",
          }}
        >
          NO PACKS YET
        </h2>
        <p
          className="mt-2"
          style={{
            fontFamily: "var(--v7-font)",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.10em",
            color: "var(--v7-text-tertiary)",
            maxWidth: "340px",
            fontWeight: 500,
          }}
        >
          PACKS ARE CREATED AUTOMATICALLY WHEN MULTIPLE ASSETS SHARE THE SAME PROMPT.
        </p>
      </div>
    );
  }

  return (
    <div
      className="p-3 w-full"
      style={{
        columnWidth: "270px",
        columnGap: "14px",
      }}
    >
      {packs.map((pack, index) => (
        <div
          key={pack._id}
          style={{
            breakInside: "avoid",
            marginBottom: "14px",
            display: "block",
          }}
        >
          <PackCard
            pack={pack}
            onClick={() => onPackSelect(pack._id)}
            index={index}
          />
        </div>
      ))}
    </div>
  );
}

/* ── Re-export detail view ── */
export { PackDetailView };
