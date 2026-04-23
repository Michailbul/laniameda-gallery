"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ImageCard } from "./image-card";
import { SkeletonGrid } from "@/components/ui/coral-skeleton";

interface GalleryImage {
  id: string;
  packId?: string;
  galleryItemId?: string;
  galleryItemType?: "asset" | "pack" | "design";
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
  previewImages: Array<{
    id: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design";
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
  onDeleteImage?: (imageId: string) => void;
  onImageSelect?: (image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design";
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
        galleryItemType?: "asset" | "pack" | "design";
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

const BATCH_SIZE = 24;

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

/* ── Round-robin distribution ── */
// Deals items left-to-right across columns like cards,
// so visual reading order matches array order (relevance).
function distributeRoundRobin<T>(items: T[], numColumns: number): T[][] {
  const columns: T[][] = Array.from({ length: numColumns }, () => []);
  for (let i = 0; i < items.length; i++) {
    columns[i % numColumns].push(items[i]);
  }
  return columns;
}

export function MasonryGrid({
  images,
  compactColumns,
  selectedImageId,
  canDelete,
  deletingImageId,
  exitingImageIds,
  onDeleteImage,
  onImageSelect,
  onImageLoad,
  loading,
}: MasonryGridProps) {
  const columnCount = useColumnCount(Boolean(compactColumns));

  // Incremental rendering — show images in batches
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  const visibleImages = images.slice(0, visibleCount);

  // Skeleton still uses CSS columns (order doesn't matter for placeholders)
  const skeletonColumnClasses = compactColumns
    ? "columns-1 sm:columns-2 md:columns-2 lg:columns-3 2xl:columns-3"
    : "columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5";

  if (loading) {
    return <SkeletonGrid columnClasses={skeletonColumnClasses} />;
  }

  const columns = distributeRoundRobin(visibleImages, columnCount);

  return (
    <>
      <div
        className="flex"
        style={{ gap: "12px", padding: "12px" }}
        aria-live="polite"
        aria-label={`Gallery showing ${images.length} image${images.length !== 1 ? "s" : ""}`}
      >
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="flex flex-1 flex-col" style={{ gap: "12px" }}>
            {col.map((image, rowIdx) => {
              // Round-robin: original index = rowIdx * columnCount + colIdx
              const originalIndex = rowIdx * columnCount + colIdx;
              return (
                <ImageCard
                  key={image.id}
                  image={image}
                  eager={originalIndex < 12}
                  onSelect={onImageSelect}
                  canDelete={canDelete}
                  deleting={deletingImageId === image.id}
                  exiting={Boolean(exitingImageIds?.has(image.id))}
                  onDelete={onDeleteImage}
                  selectedId={selectedImageId}
                  initiallyLoaded={image.initiallyLoaded}
                  onLoad={() => onImageLoad?.(image.id)}
                  index={originalIndex}
                />
              );
            })}
          </div>
        ))}
      </div>
      {visibleCount < images.length && (
        <div ref={sentinelRef} className="h-1" />
      )}
    </>
  );
}
