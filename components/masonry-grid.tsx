"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ImageCard } from "./image-card";
import { StorybookCard } from "@/components/gallery/storybook-card";
import { BeatStackCard } from "@/components/gallery/beat-stack-card";
import type { CollectionOption } from "@/components/collection-menu";
import { SkeletonGrid } from "@/components/ui/coral-skeleton";
import {
  layoutJustified,
  type JustifiedTile,
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
  galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat";
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
  /** Beat entries: every member thumb (cover first) for the hover peek fan. */
  peekThumbs?: string[];
  stepCount?: number;
  cinemaMetadata?: CinemaMetadataLite | null;
  previewImages: Array<{
    id: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat";
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
  /** Replace the entire selection set — used by shift+drag box-select. */
  onReplaceSelection?: (imageIds: string[]) => void;
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
  /** Projects the asset can be sent to via the collection menu (→ Inbox). */
  projects?: CollectionOption[];
  onAddAssetToProject?: (
    imageId: string,
    projectId: string,
  ) => Promise<void> | void;
  /** Opens the storybook modal for entries with galleryItemType "storybook". */
  onStorybookOpen?: (storybookId: string) => void;
  /** Opens a beat (direction folder) for entries with galleryItemType "beat". */
  onBeatOpen?: (beatFolderId: string) => void;
  onImageSelect?: (image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat";
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
        galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat";
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
  /**
   * Called when the scroll frontier nears the end of the images already in
   * hand — the hook for cursor pagination to fetch the next page. Fired
   * repeatedly while the frontier stays exposed; the owner must no-op while a
   * page is in flight or exhausted.
   */
  onEndReached?: () => void;
  /**
   * Tile size factor, 0.4–1. Scales the justified layout's target row height
   * so the whole grid zooms; 1 (the default) is the current full size.
   */
  zoom?: number;
}

const BATCH_SIZE = 18;
const EAGER_IMAGE_COUNT = 6;
// Mount the next batch once the frontier sentinel is within this distance of
// the viewport bottom — or anywhere above it (scrollbar drags can jump past
// the frontier in one frame).
const LOAD_MORE_MARGIN_PX = 800;

/* ── Responsive column count → target row height ── */

// Tailwind v4 breakpoints
const BREAKPOINTS = [
  { min: 1536, key: "2xl" },
  { min: 1024, key: "lg" },
  { min: 768, key: "md" },
  { min: 640, key: "sm" },
] as const;

// The justified layout has no fixed columns; instead we derive a target row
// height from a nominal column count so a square image lands at roughly one
// "column" wide (keeping the familiar density). Wide/tall items then flex
// naturally around that target.
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
      const w = el.clientWidth;
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
  onReplaceSelection,
  likeable = false,
  onToggleLike,
  draggableAssets = false,
  onAssetDragStart,
  collections,
  onMoveAssetToCollection,
  onCopyAssetToCollection,
  onRemoveAssetFromCollection,
  onCreateCollection,
  projects,
  onAddAssetToProject,
  onStorybookOpen,
  onBeatOpen,
  showPublicBadge = false,
  onEndReached,
  zoom = 1,
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

  const [gridRef, contentWidth] = useContentWidth();

  // ── Shift+drag box (marquee) selection ──
  // The layout is absolutely positioned, so each tile carries exact
  // top/left/width/height in the container's coordinate space — intersection
  // testing against a drag rectangle is direct.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  // Live drag state kept in a ref so pointer handlers don't need re-binding.
  const marqueeRef = useRef<{ x0: number; y0: number; base: Set<string>; moved: boolean } | null>(
    null,
  );
  // Set after a real drag so the trailing click doesn't also toggle a card.
  const didMarqueeRef = useRef(false);

  // Justified layout for the FULL list so tile positions are stable as batches
  // mount, then mount whole rows up to (and including) the row that holds the
  // visible-count cutoff. Mounting whole rows means the frontier is always a
  // complete edge-to-edge row — no half-filled trailing row.
  const { mounted, mountedHeight, hasMore } = useMemo(() => {
    if (contentWidth === null) {
      return {
        mounted: images
          .slice(0, effectiveVisibleCount)
          .map((image) => ({ image, tile: undefined as JustifiedTile | undefined })),
        mountedHeight: undefined as number | undefined,
        hasMore: effectiveVisibleCount < images.length,
      };
    }
    // targetRowHeight ≈ the width one column would be, so squares land at about
    // one column wide and the density matches the old grid. The zoom factor
    // scales it directly — smaller rows, more tiles per row, whole grid zooms.
    const effectiveZoom = Math.min(1, Math.max(0.4, zoom));
    const targetRowHeight =
      ((contentWidth - gap * (columnCount - 1)) / columnCount) * effectiveZoom;
    const { tiles } = layoutJustified(images.map(resolveGridLayoutInput), {
      containerWidth: contentWidth,
      gap,
      targetRowHeight,
    });

    // Extend the cutoff to the end of the row containing the last visible item.
    let cutoff = Math.min(effectiveVisibleCount, images.length);
    if (cutoff > 0 && cutoff < images.length) {
      const cutoffRow = tiles[cutoff - 1]?.row;
      while (cutoff < images.length && tiles[cutoff]?.row === cutoffRow) {
        cutoff += 1;
      }
    }

    const mounted = images
      .slice(0, cutoff)
      .map((image, i) => ({ image, tile: tiles[i] }));
    let mountedHeight = 0;
    for (const { tile } of mounted) {
      if (tile) mountedHeight = Math.max(mountedHeight, tile.top + tile.height);
    }
    return { mounted, mountedHeight, hasMore: cutoff < images.length };
  }, [columnCount, contentWidth, gap, images, effectiveVisibleCount, zoom]);

  // Load-more driver. The container height is only as tall as MOUNTED content,
  // so the sentinel sits just under the last mounted row. On a fast scroll or
  // scrollbar drag it can be far above the viewport bottom — an
  // IntersectionObserver with a finite rootMargin would miss it. Instead, check
  // the sentinel's position on scroll/resize: anything above
  // `viewport bottom + margin` means the user is at or past the frontier.
  useEffect(() => {
    if (!hasMore && !onEndReached) return;
    let ticking = false;
    const check = () => {
      ticking = false;
      const sentinel = sentinelRef.current;
      if (!sentinel) return;
      const top = sentinel.getBoundingClientRect().top;
      if (top < window.innerHeight + LOAD_MORE_MARGIN_PX) {
        // Mount more of what we already have first; once everything in hand
        // is mounted, ask the owner for the next page of data.
        if (hasMore) loadMore();
        else onEndReached?.();
      }
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
  }, [hasMore, mountedHeight, loadMore, onEndReached]);

  // Skeleton still uses CSS columns (order doesn't matter for placeholders)
  const skeletonColumnClasses = compactColumns
    ? "columns-1 sm:columns-2 md:columns-2 lg:columns-3 2xl:columns-3"
    : "columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5";

  const marqueeEnabled = selectable && Boolean(onReplaceSelection);

  const beginMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    // Reserve shift+primary-drag for box-select; a plain drag still drags cards.
    if (!marqueeEnabled || !event.shiftKey || event.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x0 = event.clientX - rect.left;
    const y0 = event.clientY - rect.top;
    marqueeRef.current = {
      x0,
      y0,
      base: new Set(selectedAssetIds ?? []),
      moved: false,
    };
    setMarquee({ left: x0, top: y0, width: 0, height: 0 });
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
    event.preventDefault();
  };

  const updateMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = marqueeRef.current;
    const el = containerRef.current;
    if (!state || !el) return;
    const rect = el.getBoundingClientRect();
    const x1 = Math.max(0, Math.min(event.clientX - rect.left, el.clientWidth));
    const y1 = Math.max(0, event.clientY - rect.top);
    const left = Math.min(state.x0, x1);
    const top = Math.min(state.y0, y1);
    const width = Math.abs(x1 - state.x0);
    const height = Math.abs(y1 - state.y0);
    if (width > 3 || height > 3) state.moved = true;
    setMarquee({ left, top, width, height });

    const right = left + width;
    const bottom = top + height;
    const hit = new Set(state.base);
    for (const { image, tile } of mounted) {
      if (!tile) continue;
      const isAsset =
        image.galleryItemType === "asset" || image.galleryItemType === undefined;
      if (!isAsset) continue;
      const intersects =
        tile.left < right &&
        tile.left + tile.width > left &&
        tile.top < bottom &&
        tile.top + tile.height > top;
      if (intersects) hit.add(image.id);
    }
    onReplaceSelection?.(Array.from(hit));
  };

  const endMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = marqueeRef.current;
    if (!state) return;
    if (state.moved) didMarqueeRef.current = true;
    marqueeRef.current = null;
    setMarquee(null);
    try {
      containerRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* release is best-effort */
    }
  };

  if (loading) {
    return <SkeletonGrid columnClasses={skeletonColumnClasses} />;
  }

  return (
    <div style={{ padding: `${PADDING_PX}px` }}>
      <div
        ref={(node) => {
          gridRef(node);
          containerRef.current = node;
        }}
        onPointerDown={marqueeEnabled ? beginMarquee : undefined}
        onPointerMove={marqueeEnabled ? updateMarquee : undefined}
        onPointerUp={marqueeEnabled ? endMarquee : undefined}
        onPointerCancel={marqueeEnabled ? endMarquee : undefined}
        // Shift is reserved for box-select — never start a native card drag.
        onDragStartCapture={
          marqueeEnabled
            ? (event) => {
                if (event.shiftKey) event.preventDefault();
              }
            : undefined
        }
        // Swallow the click that ends a real drag so it doesn't toggle a card.
        onClickCapture={
          marqueeEnabled
            ? (event) => {
                if (didMarqueeRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  didMarqueeRef.current = false;
                }
              }
            : undefined
        }
        style={{
          position: "relative",
          width: "100%",
          height: mountedHeight !== undefined ? `${mountedHeight}px` : undefined,
          userSelect: marquee ? "none" : undefined,
        }}
        aria-live="polite"
        aria-label={`Gallery showing ${images.length} image${images.length !== 1 ? "s" : ""}`}
      >
        {mounted.map(({ image, tile }, originalIndex) => {
          const isAssetCard =
            image.galleryItemType === "asset" ||
            image.galleryItemType === undefined;
          const canDrag = draggableAssets && isAssetCard && Boolean(onAssetDragStart);
          const tileStyle: React.CSSProperties = tile
            ? {
                position: "absolute",
                top: `${tile.top}px`,
                left: `${tile.left}px`,
                width: `${tile.width}px`,
                height: `${tile.height}px`,
                // Tiles are size containers so card chrome (hover toolbar)
                // can compact itself on narrow tiles via @container queries.
                containerType: "inline-size",
              }
            : { position: "relative", width: "100%", containerType: "inline-size" };

          if (image.galleryItemType === "beat" && onBeatOpen) {
            return (
              <div key={image.id} style={tileStyle}>
                <BeatStackCard
                  beat={{
                    id: image.id,
                    beatFolderId: image.galleryItemId ?? image.id,
                    name: image.prompt,
                    count: image.storybookCount ?? image.previewImages.length,
                    coverSrc: image.src !== "/placeholder.svg" ? image.src : undefined,
                    coverKind: image.kind,
                    peekThumbs: image.peekThumbs ?? [],
                  }}
                  eager={originalIndex < EAGER_IMAGE_COUNT}
                  onOpen={onBeatOpen}
                />
              </div>
            );
          }
          if (image.galleryItemType === "storybook" && onStorybookOpen) {
            return (
              <div key={image.id} style={tileStyle}>
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
              style={tileStyle}
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
                selectionActive={Boolean(selectedAssetIds && selectedAssetIds.size > 0)}
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
                projects={isAssetCard ? projects : undefined}
                onAddToProject={isAssetCard ? onAddAssetToProject : undefined}
                showPublicBadge={showPublicBadge}
              />
            </div>
          );
        })}
        {(hasMore || onEndReached) && (
          <div
            ref={sentinelRef}
            className="h-px"
            style={
              mountedHeight !== undefined
                ? { position: "absolute", left: 0, right: 0, top: `${mountedHeight}px` }
                : { position: "relative" }
            }
            aria-hidden
          />
        )}
        {marquee && (marquee.width > 2 || marquee.height > 2) && (
          <div
            style={{
              position: "absolute",
              left: `${marquee.left}px`,
              top: `${marquee.top}px`,
              width: `${marquee.width}px`,
              height: `${marquee.height}px`,
              background: "color-mix(in srgb, var(--lm-coral) 16%, transparent)",
              border: "1px solid var(--lm-coral)",
              borderRadius: "4px",
              pointerEvents: "none",
              zIndex: 40,
            }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
