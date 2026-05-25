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
}: MasonryGridProps) {
  const columnCount = useColumnCount(Boolean(compactColumns));
  const gap = gapPx ?? DEFAULT_GAP_PX;

  // Incremental rendering — show images in batches
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(Math.min(BATCH_SIZE, images.length));
  }, [images]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, images.length));
  }, [images.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= images.length) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, images.length, loadMore]);

  const visibleImages = useMemo(
    () => images.slice(0, visibleCount),
    [images, visibleCount],
  );

  // Skeleton still uses CSS columns (order doesn't matter for placeholders)
  const skeletonColumnClasses = compactColumns
    ? "columns-1 sm:columns-2 md:columns-2 lg:columns-3 2xl:columns-3"
    : "columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5";

  const [gridRef, contentWidth] = useContentWidth();

  const packedLayout = useMemo(() => {
    if (contentWidth === null) {
      return null;
    }
    return packMasonry(
      visibleImages.map(
        (image): LayoutInput => ({
          width: image.width,
          height: image.height,
          kind: image.kind,
        }),
      ),
      {
        contentWidth,
        columnCount,
        gap,
      },
    );
  }, [columnCount, contentWidth, gap, visibleImages]);

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
        {visibleImages.map((image, originalIndex) => {
          const placement = packedLayout?.placements[originalIndex];
          return (
            <div
              key={image.id}
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
              />
            </div>
          );
        })}
      </div>
      {visibleCount < images.length && (
        <div ref={sentinelRef} className="h-1" />
      )}
    </>
  );
}
