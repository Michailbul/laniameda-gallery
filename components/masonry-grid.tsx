"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ImageCard } from "./image-card";
import { StorybookCard } from "@/components/gallery/storybook-card";
import type { CollectionOption } from "@/components/collection-menu";
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
  galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook";
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
  folderIds?: string[];
  isPublic?: boolean;
  isFeatured?: boolean;
  isLiked?: boolean;
  packMemberCount?: number;
  storybookCount?: number;
  stepCount?: number;
  cinemaMetadata?: CinemaMetadataLite | null;
  previewImages: Array<{
    id: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook";
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
  collections?: CollectionOption[];
  onMoveAssetToCollection?: (
    imageId: string,
    folderId: string,
  ) => Promise<void> | void;
  onCopyAssetToCollection?: (
    imageId: string,
    folderId: string,
  ) => Promise<void> | void;
  onRemoveAssetFromCollection?: (
    imageId: string,
    folderId: string,
  ) => Promise<void> | void;
  onCreateCollection?: (name: string) => Promise<string | null>;
  /** Opens the storybook modal for entries with galleryItemType "storybook". */
  onStorybookOpen?: (storybookId: string) => void;
  onImageSelect?: (image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook";
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
        galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook";
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
// Mount the next batch once the frontier sentinel is within this distance of
// the viewport bottom — or anywhere above it (scrollbar drags can jump past
// the frontier in one frame).
const LOAD_MORE_MARGIN_PX = 800;

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
  collections,
  onMoveAssetToCollection,
  onCopyAssetToCollection,
  onRemoveAssetFromCollection,
  onCreateCollection,
  onStorybookOpen,
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

  // Load-more driver. The grid always reserves rows for the FULL packed list,
  // so the sentinel (anchored at the mounted frontier) can be thousands of
  // pixels above the viewport after a fast scroll or scrollbar drag — an
  // IntersectionObserver with a finite rootMargin would never fire there.
  // Instead, check the sentinel's position on scroll/resize: anything above
  // `viewport bottom + margin` means the user is at or past the frontier.
  useEffect(() => {
    if (effectiveVisibleCount >= images.length) return;
    let ticking = false;
    const check = () => {
      ticking = false;
      const sentinel = sentinelRef.current;
      if (!sentinel) return;
      const top = sentinel.getBoundingClientRect().top;
      if (top < window.innerHeight + LOAD_MORE_MARGIN_PX) loadMore();
    };
    const schedule = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(check);
    };
    // Run once immediately: chains batches until the frontier clears the
    // viewport (initial fill, and after every batch mounts).
    check();
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
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
  const { orderedCards, frontierRow } = useMemo(() => {
    if (contentWidth === null) {
      return {
        orderedCards: images
          .slice(0, effectiveVisibleCount)
          .map((image) => ({ image, placement: undefined })),
        frontierRow: undefined,
      };
    }
    const { placements } = packMasonry(
      images.map(resolveGridLayoutInput),
      {
        contentWidth,
        columnCount,
        gap,
      },
    );
    const orderedCards = [...placements]
      .sort((a, b) => a.startRow - b.startRow || a.column - b.column)
      .slice(0, effectiveVisibleCount)
      .map((placement) => ({ image: images[placement.index]!, placement }));
    // Deepest mounted row — the sentinel anchors here so load-more tracks the
    // mounted frontier instead of the (full-height) grid bottom.
    let frontierRow = 1;
    for (const { placement } of orderedCards) {
      frontierRow = Math.max(frontierRow, placement.startRow + placement.rowSpan);
    }
    return { orderedCards, frontierRow };
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
          if (image.galleryItemType === "storybook" && onStorybookOpen) {
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
                <StorybookCard
                  storybook={{
                    id: image.id,
                    storybookId: image.galleryItemId ?? image.id,
                    name: image.prompt,
                    count: image.storybookCount ?? image.previewImages.length,
                    previews: image.previewImages.map((preview) => ({
                      id: preview.id,
                      src: preview.src,
                      width: preview.width,
                      height: preview.height,
                      kind: preview.kind,
                    })),
                  }}
                  eager={originalIndex < EAGER_IMAGE_COUNT}
                  onOpen={onStorybookOpen}
                />
              </div>
            );
          }
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
                collections={isAssetCard ? collections : undefined}
                onMoveToCollection={
                  isAssetCard ? onMoveAssetToCollection : undefined
                }
                onCopyToCollection={
                  isAssetCard ? onCopyAssetToCollection : undefined
                }
                onRemoveFromCollection={
                  isAssetCard ? onRemoveAssetFromCollection : undefined
                }
                onCreateCollection={
                  isAssetCard ? onCreateCollection : undefined
                }
                showPublicBadge={showPublicBadge}
              />
            </div>
          );
        })}
        {effectiveVisibleCount < images.length && (
          <div
            ref={sentinelRef}
            className="h-px"
            style={
              frontierRow !== undefined
                ? { gridColumn: "1 / -1", gridRow: `${frontierRow} / span 1` }
                : { gridColumn: "1 / -1" }
            }
            aria-hidden
          />
        )}
      </div>
    </>
  );
}
