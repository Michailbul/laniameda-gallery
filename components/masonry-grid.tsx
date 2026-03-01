"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageCard } from "./image-card";

interface GalleryImage {
  id: string;
  src: string;
  fullSrc: string;
  prompt: string;
  author: string;
  likes: number;
  width?: number;
  height?: number;
  initiallyLoaded?: boolean;
  modelName?: string;
  pillar?: string;
  tagNames?: string[];
  sourceUrl?: string;
  createdAt?: number;
}

interface MasonryGridProps {
  images: GalleryImage[];
  compactColumns?: boolean;
  selectedImageId?: string;
  onImageSelect?: (image: {
    id: string;
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
  }) => void;
  onImageLoad?: (imageId: string) => void;
  loading?: boolean;
}

const BATCH_SIZE = 24;

const SKELETON_ASPECT_RATIOS = [
  "3/4", "1/1", "4/5", "3/4", "16/9", "1/1",
  "4/5", "3/4", "1/1", "3/4", "4/5", "16/9",
];

export function MasonryGrid({
  images,
  compactColumns,
  selectedImageId,
  onImageSelect,
  onImageLoad,
  loading,
}: MasonryGridProps) {
  const columnClasses = compactColumns
    ? "columns-1 sm:columns-2 md:columns-2 lg:columns-3 2xl:columns-3"
    : "columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5";

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

  if (loading) {
    return (
      <div
        className={columnClasses}
        style={{ columnGap: "12px", padding: "12px" }}
      >
        {SKELETON_ASPECT_RATIOS.map((ratio, i) => (
          <div
            key={i}
            className="mb-3 overflow-hidden rounded-xl"
            style={{
              aspectRatio: ratio,
              breakInside: "avoid-column",
              backgroundColor: "var(--surface-1)",
            }}
          >
            <div
              className="h-full w-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.04) 50%, transparent 100%)",
                backgroundSize: "200% 100%",
                animation: "shimmer 1.5s infinite linear",
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={columnClasses}
      style={{
        columnGap: "12px",
        padding: "12px",
      }}
      aria-live="polite"
      aria-label={`Gallery showing ${images.length} image${images.length !== 1 ? "s" : ""}`}
    >
      {visibleImages.map((image, index) => (
        <ImageCard
          key={image.id}
          image={image}
          eager={index < 12}
          onSelect={onImageSelect}
          selectedId={selectedImageId}
          initiallyLoaded={image.initiallyLoaded}
          onLoad={() => onImageLoad?.(image.id)}
          index={index}
        />
      ))}
      {visibleCount < images.length && (
        <div ref={sentinelRef} className="h-1" />
      )}
    </div>
  );
}
