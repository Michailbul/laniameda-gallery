"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ImageCard } from "./image-card";
import { SkeletonGrid } from "@/components/ui/coral-skeleton";
import {
  ROW_UNIT_PX,
  packMasonry,
  type LayoutInput,
} from "@/lib/masonry-layout";

type CinemaMetadataLite = {
  movieTitle: string;
  director?: string;
  year?: number;
  scene?: string;
  cinematographer?: string;
  lens?: string;
  aperture?: string;
  composition?: string;
  lighting?: string;
  cameraMovement?: string;
  colorPalette?: string;
  mood?: string;
  agentDescription?: string;
  timecode?: string;
};

interface GalleryImage {
  id: string;
  packId?: string;
  galleryItemId?: string;
  galleryItemType?: "asset" | "pack" | "design" | "workflow";
  src: string;
  fullSrc: string;
  prompt: string;
  author: string;
  likes: number;
  width?: number;
  height?: number;
  initiallyLoaded?: boolean;
  kind?: "image" | "video";
  contentType?: string;
  modelName?: string;
  pillar?: string;
  tagNames?: string[];
  sourceUrl?: string;
  createdAt?: number;
  folderId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  isLiked?: boolean;
  packMemberCount?: number;
  stepCount?: number;
  cinemaMetadata?: CinemaMetadataLite | null;
  previewImages: Array<{
    id: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow";
    src: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    kind?: "image" | "video";
    contentType?: string;
  }>;
}

interface MasonryGridProps {
  images: GalleryImage[];
  compactColumns?: boolean;
  selectedImageId?: string;
  canDelete?: boolean;
  deletingImageId?: string | null;
  exitingImageIds?: Set<string>;
  gapPx?: number;
  onDeleteImage?: (imageId: string) => void;
  selectable?: boolean;
  selectedAssetIds?: Set<string>;
  onToggleAssetSelect?: (imageId: string) => void;
  likeable?: boolean;
  onToggleLike?: (imageId: string, nextLiked: boolean) => void;
  draggableAssets?: boolean;
  onAssetDragStart?: (
    event: React.DragEvent<HTMLDivElement>,
    imageId: string,
  ) => void;
  onImageSelect?: (image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow";
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    kind?: "image" | "video";
    contentType?: string;
    modelName?: string;
    pillar?: string;
    tagNames?: string[];
      sourceUrl?: string;
      createdAt?: number;
      folderId?: string;
      isPublic?: boolean;
      isFeatured?: boolean;
      isLiked?: boolean;
      previewImages: Array<{
        id: string;
        galleryItemId?: string;
        galleryItemType?: "asset" | "pack" | "design" | "workflow";
        src: string;
        fullSrc: string;
        prompt: string;
        width?: number;
        height?: number;
        kind?: "image" | "video";
        contentType?: string;
      }>;
    }) => void;
  onImageLoad?: (imageId: string) => void;
  loading?: boolean;
  showPublicBadge?: boolean;
}

const BATCH_SIZE = 18;
const EAGER_IMAGE_COUNT = 6;

/* ── Responsive column count hook ── */

// Tailwind v4 breakpoints
const BREAKPOINTS = [
  { min: 1536, key: "2xl" },
  { min: 1024, key: "lg" },
  { min: 768, key: "md" },
  { min: 640, key: "sm" },
] as const;

const COLUMN_MAP = {
  normal: { "2xl": 5, lg: 4, md: 3, sm: 2, default: 2 },
  compact: { "2xl": 3, lg: 3, md: 2, sm: 2, default: 1 },
} as const;

function getColumnCount(compact: boolean): number {
  if (typeof window === "undefined") return compact ? 1 : 2;
  const map = compact ? COLUMN_MAP.compact : COLUMN_MAP.normal;
  for (const bp of BREAKPOINTS) {
    if (window.innerWidth >= bp.min) return map[bp.key];
  }
  return map.default;
}

function useColumnCount(compact: boolean): number {
  // SSR-safe: subscribe to resize events
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => getColumnCount(compact),
    () => (compact ? 1 : 2), // server snapshot
  );
}

/* ── Grid sizing ── */
const DEFAULT_GAP_PX = 12;
const PADDING_PX = 12;

function resolveGridLayoutInput(image: GalleryImage): LayoutInput {
  const preview = image.previewImages[0];
  return {
    width: preview?.width ?? image.width,
    height: preview?.height ?? image.height,
    kind: preview?.kind ?? image.kind,
    contentType: preview?.contentType ?? image.contentType,
  };
}

function useContentWidth(): [
  (el: HTMLDivElement | null) => void,
  number | null,
] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      const cs = window.getComputedStyle(el);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const w = el.clientWidth - padL - padR;
      setWidth(w > 0 ? w : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

export function MasonryGrid({
  images,
  compactColumns,
  selectedImageId,
  canDelete,
  deletingImageId,
  exitingImageIds,
  gapPx,
  onDeleteImage,
  onImageSelect,
  onImageLoad,
  loading,
  selectable = false,
  selectedAssetIds,
  onToggleAssetSelect,
  likeable = false,
  onToggleLike,
  draggableAssets = false,
  onAssetDragStart,
  showPublicBadge = false,
}: MasonryGridProps) {
  const columnCount = useColumnCount(Boolean(compactColumns));
  const gap = gapPx ?? DEFAULT_GAP_PX;

  // Incremental rendering — show images in batches
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Clamp at render time and never shrink the counter on list re-emits:
  // Convex queries re-emit a fresh array identity on any table write, and
  // resetting to the first batch would unmount cards under the user's
  // viewport mid-scroll — the grid would show giant holes until the scroll
  // sentinel re-fired.
  const effectiveVisibleCount = Math.min(
    Math.max(visibleCount, BATCH_SIZE),
    images.length,
  );

  const loadMore = useCallback(() => {
    setVisibleCount((prev) =>
      Math.min(Math.max(prev, BATCH_SIZE) + BATCH_SIZE, images.length),
    );
  }, [images.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || effectiveVisibleCount >= images.length) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [effectiveVisibleCount, images.length, loadMore]);

  // Skeleton still uses CSS columns (order doesn't matter for placeholders)
  const skeletonColumnClasses = compactColumns
    ? "columns-1 sm:columns-2 md:columns-2 lg:columns-3 2xl:columns-3"
    : "columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5";

  const [gridRef, contentWidth] = useContentWidth();

  // Pack the FULL list (not just the visible batch) so placements are stable
  // as batches mount, then mount cards in visual (top-to-bottom) order — the
  // packer may place a later item above an earlier one when leveling columns
  // under a wide card, and mounting by array order would leave holes at the
  // top until that item's batch loads.
  const orderedCards = useMemo(() => {
    if (contentWidth === null) {
      return images
        .slice(0, effectiveVisibleCount)
        .map((image) => ({ image, placement: undefined }));
    }
    const { placements } = packMasonry(
      images.map(resolveGridLayoutInput),
      {
        contentWidth,
        columnCount,
        gap,
      },
    );
    return [...placements]
      .sort((a, b) => a.startRow - b.startRow || a.column - b.column)
      .slice(0, effectiveVisibleCount)
      .map((placement) => ({ image: images[placement.index]!, placement }));
  }, [columnCount, contentWidth, gap, images, effectiveVisibleCount]);

  if (loading) {
    return <SkeletonGrid columnClasses={skeletonColumnClasses} />;
  }

  return (
    <>
      <div
        ref={gridRef}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_UNIT_PX}px`,
          gap: `${gap}px`,
          padding: `${PADDING_PX}px`,
        }}
        aria-live="polite"
        aria-label={`Gallery showing ${images.length} image${images.length !== 1 ? "s" : ""}`}
      >
        {orderedCards.map(({ image, placement }, originalIndex) => {
          const isAssetCard =
            image.galleryItemType === "asset" ||
            image.galleryItemType === undefined;
          const canDrag = draggableAssets && isAssetCard && Boolean(onAssetDragStart);
          return (
            <div
              key={image.id}
              draggable={canDrag || undefined}
              onDragStart={
                canDrag
                  ? (event) => onAssetDragStart!(event, image.id)
                  : undefined
              }
              style={{
                gridColumn: placement
                  ? `${placement.column + 1} / span ${placement.colSpan}`
                  : "span 1",
                gridRow: placement
                  ? `${placement.startRow} / span ${placement.rowSpan}`
                  : "span 1",
                display: "grid",
                minWidth: 0,
              }}
            >
              <ImageCard
                image={image}
                eager={originalIndex < EAGER_IMAGE_COUNT}
                onSelect={onImageSelect}
                canDelete={canDelete}
                deleting={deletingImageId === image.id}
                exiting={Boolean(exitingImageIds?.has(image.id))}
                onDelete={onDeleteImage}
                selectedId={selectedImageId}
                initiallyLoaded={image.initiallyLoaded}
                onLoad={onImageLoad}
                index={originalIndex}
                selectable={
                  selectable &&
                  (image.galleryItemType === "asset" ||
                    image.galleryItemType === undefined)
                }
                selected={Boolean(selectedAssetIds?.has(image.id))}
                onToggleSelect={onToggleAssetSelect}
                likeable={
                  likeable &&
                  (image.galleryItemType === "asset" ||
                    image.galleryItemType === undefined)
                }
                liked={Boolean(image.isLiked)}
                onToggleLike={onToggleLike}
                showPublicBadge={showPublicBadge}
              />
            </div>
          );
        })}
      </div>
      {effectiveVisibleCount < images.length && (
        <div ref={sentinelRef} className="h-1" />
      )}
    </>
  );
}
