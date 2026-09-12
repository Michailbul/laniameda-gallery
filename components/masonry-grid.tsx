"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ImageCard } from "./image-card";
import { StorybookCard } from "@/components/gallery/storybook-card";
import { BeatStackCard } from "@/components/gallery/beat-stack-card";
import { CollectionStackCard } from "@/components/gallery/collection-stack-card";
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
  galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat" | "collection";
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
  /** Optional caption revealed on card hover (public surface: the world an asset belongs to). */
  overlayLabel?: string;
  pillar?: string;
  tagNames?: string[];
  sourceUrl?: string;
  createdAt?: number;
  folderId?: string;
  folderIds?: string[];
  /** Collections this piece is filed in, already resolved to display labels. */
  collectionLabels?: string[];
  /** What the piece is — Character / Location / Scene / Inspiration. */
  typeLabel?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  isLiked?: boolean;
  starredAt?: number;
  starNote?: string;
  packMemberCount?: number;
  storybookCount?: number;
  /** Beat entries: every member thumb (cover first) for the hover peek fan. */
  peekThumbs?: string[];
  stepCount?: number;
  cinemaMetadata?: CinemaMetadataLite | null;
  previewImages: Array<{
    id: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat" | "collection";
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
  onToggleAssetSelect?: (imageId: string, mode?: "toggle" | "range") => void;
  /** Replace the entire selection set — used by shift+drag box-select. */
  onReplaceSelection?: (imageIds: string[]) => void;
  likeable?: boolean;
  onToggleLike?: (imageId: string, nextLiked: boolean) => void;
  /** Owner-only: cards offer the star toggle. */
  starrable?: boolean;
  onToggleStar?: (imageId: string, nextStarred: boolean) => void;
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
  onRenameCollection?: (folderId: string, name: string) => Promise<void> | void;
  /** Projects the asset can be sent to via the collection menu (→ Inbox). */
  projects?: CollectionOption[];
  onAddAssetToProject?: (
    imageId: string,
    projectId: string,
  ) => Promise<void> | void;
  /** Owner-only: card hover surfaces tag chips; clicking one removes it. */
  onRemoveAssetTag?: (imageId: string, tagName: string) => void;
  /** One-click exclude on card hover: drops the piece from the collection,
      beat, or project the grid is scoped to. Unset on the flat gallery. */
  onExcludeAssetFromView?: (imageId: string) => Promise<void> | void;
  excludeLabel?: string;
  excludeFolderId?: string;
  /** Opens the storybook modal for entries with galleryItemType "storybook". */
  onStorybookOpen?: (storybookId: string) => void;
  /** Opens a beat (beat folder) for entries with galleryItemType "beat". */
  onBeatOpen?: (beatFolderId: string) => void;
  /** Beat management — hover actions on the stack card. */
  onBeatUnpack?: (beatFolderId: string) => void;
  onBeatDelete?: (beatFolderId: string) => void;
  /** Opens a nested collection entry. */
  onCollectionOpen?: (collectionId: string) => void;
  onImageSelect?: (image: {
    id: string;
    packId?: string;
    galleryItemId?: string;
    galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat" | "collection";
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    kind?: "image" | "video";
    contentType?: string;
    modelName?: string;
    /** Optional caption revealed on card hover (public surface: the world an asset belongs to). */
    overlayLabel?: string;
    pillar?: string;
    tagNames?: string[];
      sourceUrl?: string;
      createdAt?: number;
      folderId?: string;
      isPublic?: boolean;
      isFeatured?: boolean;
      isLiked?: boolean;
      starredAt?: number;
      starNote?: string;
      previewImages: Array<{
        id: string;
        galleryItemId?: string;
        galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "beat" | "collection";
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
// Box-select auto-scroll: how close to the viewport edge the pointer has to
// get before the page starts moving under it, and the fastest it may move.
const AUTO_SCROLL_EDGE_PX = 80;
// How far a press has to travel before it counts as a box and not a click.
const DRAG_THRESHOLD_PX = 4;
const AUTO_SCROLL_MAX_PX = 28;

/** Nearest ancestor that actually scrolls — the window when nothing else does. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

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
  starrable = false,
  onToggleStar,
  draggableAssets = false,
  onAssetDragStart,
  collections,
  onMoveAssetToCollection,
  onCopyAssetToCollection,
  onRemoveAssetFromCollection,
  onCreateCollection,
  onRenameCollection,
  projects,
  onAddAssetToProject,
  onRemoveAssetTag,
  onExcludeAssetFromView,
  excludeLabel,
  excludeFolderId,
  onStorybookOpen,
  onBeatOpen,
  onBeatUnpack,
  onBeatDelete,
  onCollectionOpen,
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

  // ── Box (marquee) selection ──
  // The layout is absolutely positioned, so each tile carries exact
  // top/left/width/height in the container's coordinate space — intersection
  // testing against a drag rectangle is direct.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // A press that may or may not become a box. Nothing happens on pointerdown
  // itself: taking pointer capture there makes Chrome retarget the trailing
  // click to the capturing element, and a shift-click on a card would never
  // reach the card. The box starts on the first move past the threshold.
  const pendingRef = useRef<{
    x0: number;
    y0: number;
    clientX: number;
    clientY: number;
    additive: boolean;
    pointerId: number;
    onEmptySpace: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  // Live drag state kept in a ref so pointer handlers don't need re-binding.
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    base: Set<string>;
  } | null>(null);
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

  // The mounted tiles' rects, mirrored into a ref. A drag holds its handlers
  // for the whole gesture, and auto-scroll mounts fresh rows underneath it —
  // hit-testing the closure's copy would ignore everything that arrived after
  // the press.
  const tilesRef = useRef(mounted);
  useEffect(() => {
    tilesRef.current = mounted;
  }, [mounted]);

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

  // Is a box modifier down right now? While one is, tiles stop being
  // draggable, so the browser can't win the race and start the filing drag
  // before the box does. preventDefault on dragstart is not enough — by then
  // the press has already been claimed.
  const [boxModifierHeld, setBoxModifierHeld] = useState(false);
  useEffect(() => {
    if (!marqueeEnabled) return;
    const sync = (event: KeyboardEvent) =>
      setBoxModifierHeld(event.shiftKey || event.metaKey || event.ctrlKey);
    const clear = () => setBoxModifierHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, [marqueeEnabled]);

  // Cmd/Ctrl+A takes the whole grid, the way it does in a file manager.
  useEffect(() => {
    if (!marqueeEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "a" && event.key !== "A") return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }
      event.preventDefault();
      onReplaceSelection?.(
        images
          .filter(
            (image) =>
              image.galleryItemType === "asset" ||
              image.galleryItemType === undefined,
          )
          .map((image) => image.id),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [marqueeEnabled, images, onReplaceSelection]);

  // Where the pointer is right now, in client space. Auto-scroll re-runs the
  // hit test between moves, so it needs a position of its own to read.
  const pointerRef = useRef({ clientX: 0, clientY: 0 });
  const scrollerRef = useRef<HTMLElement | null>(null);
  const autoScrollRef = useRef<number | null>(null);

  const applyMarquee = useCallback(() => {
    const state = marqueeRef.current;
    const el = containerRef.current;
    if (!state || !el) return;
    const rect = el.getBoundingClientRect();
    const x1 = Math.max(
      0,
      Math.min(pointerRef.current.clientX - rect.left, el.clientWidth),
    );
    const y1 = Math.max(
      0,
      Math.min(pointerRef.current.clientY - rect.top, el.clientHeight),
    );
    const left = Math.min(state.x0, x1);
    const top = Math.min(state.y0, y1);
    const width = Math.abs(x1 - state.x0);
    const height = Math.abs(y1 - state.y0);
    setMarquee({ left, top, width, height });

    const right = left + width;
    const bottom = top + height;
    const hit = new Set(state.base);
    for (const { image, tile } of tilesRef.current) {
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
  }, [onReplaceSelection]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current === null) return;
    cancelAnimationFrame(autoScrollRef.current);
    autoScrollRef.current = null;
  }, []);

  // Drag past the top or bottom edge and the page follows, so a box can run
  // longer than one screen. Speed ramps with how far past the edge you are.
  const startAutoScroll = useCallback(() => {
    const step = () => {
      autoScrollRef.current = null;
      if (!marqueeRef.current) return;
      const { clientY } = pointerRef.current;
      const above = clientY - AUTO_SCROLL_EDGE_PX;
      const below = clientY - (window.innerHeight - AUTO_SCROLL_EDGE_PX);
      let delta = 0;
      if (above < 0) delta = Math.max(-AUTO_SCROLL_MAX_PX, above / 3);
      else if (below > 0) delta = Math.min(AUTO_SCROLL_MAX_PX, below / 3);
      if (delta !== 0) {
        const scroller = scrollerRef.current;
        if (scroller) scroller.scrollTop += delta;
        else window.scrollBy(0, delta);
        applyMarquee();
      }
      autoScrollRef.current = requestAnimationFrame(step);
    };
    stopAutoScroll();
    autoScrollRef.current = requestAnimationFrame(step);
  }, [applyMarquee, stopAutoScroll]);

  // A wheel scroll mid-drag moves the tiles under a box anchored to the grid,
  // not to the viewport — re-run the hit test so what is inside it is true.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const onScroll = () => applyMarquee();
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("scroll", onScroll, { capture: true });
  }, [dragging, applyMarquee]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const beginMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    // Any fresh press ends the previous gesture's grace period. Without this
    // the click-swallow below outlives its drag and eats the next real click
    // on a card — box-select once, and the card after it refuses to open.
    didMarqueeRef.current = false;
    pendingRef.current = null;
    if (!marqueeEnabled || event.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    // Two ways in, both a plain left drag:
    //   · shift or cmd/ctrl held — boxes from anywhere, cards included, and
    //     ADDS to the selection. It needs the modifier there because a bare
    //     drag off a card is the filing drag.
    //   · a press on empty grid — the gutters, the gaps between tiles, the
    //     margin around the whole thing — needs no modifier and REPLACES,
    //     which is what every file manager does.
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    // Empty space is decided by the layout, not by what the press landed on:
    // a hovered card scales past its tile and its image covers the gutter, so
    // asking the DOM what is under the cursor there answers "a card" for a
    // pixel that belongs to nobody.
    const rect = el.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const onEmptySpace = !tilesRef.current.some(
      ({ tile }) =>
        tile &&
        rawX >= tile.left &&
        rawX <= tile.left + tile.width &&
        rawY >= tile.top &&
        rawY <= tile.top + tile.height,
    );
    if (!additive && !onEmptySpace) return;
    pendingRef.current = {
      x0: Math.max(0, Math.min(rawX, el.clientWidth)),
      y0: Math.max(0, Math.min(rawY, el.clientHeight)),
      clientX: event.clientX,
      clientY: event.clientY,
      additive,
      pointerId: event.pointerId,
      onEmptySpace,
    };
  };

  const updateMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (marqueeRef.current) {
      applyMarquee();
      return;
    }
    // Still deciding. A press that never travels stays a click.
    const pending = pendingRef.current;
    if (!pending) return;
    if (
      Math.abs(event.clientX - pending.clientX) < DRAG_THRESHOLD_PX &&
      Math.abs(event.clientY - pending.clientY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    marqueeRef.current = {
      x0: pending.x0,
      y0: pending.y0,
      base: pending.additive ? new Set(selectedAssetIds ?? []) : new Set(),
    };
    scrollerRef.current = findScrollParent(containerRef.current);
    try {
      wrapperRef.current?.setPointerCapture(pending.pointerId);
    } catch {
      /* capture is best-effort */
    }
    setDragging(true);
    startAutoScroll();
    applyMarquee();
    event.preventDefault();
  };

  const endMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = marqueeRef.current;
    const pending = pendingRef.current;
    pendingRef.current = null;
    stopAutoScroll();
    if (!state) {
      // A press on empty space that never became a box: drop the selection,
      // the way clicking the background of a file manager does.
      if (
        pending?.onEmptySpace &&
        !pending.additive &&
        (selectedAssetIds?.size ?? 0) > 0
      ) {
        onReplaceSelection?.([]);
      }
      return;
    }
    didMarqueeRef.current = true;
    marqueeRef.current = null;
    setMarquee(null);
    setDragging(false);
    try {
      wrapperRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* release is best-effort */
    }
  };

  if (loading) {
    return <SkeletonGrid columnClasses={skeletonColumnClasses} />;
  }

  return (
    // The gesture lives on the padded wrapper, not just the tile plane, so the
    // margin around the grid is draggable empty space too — otherwise the only
    // no-modifier way in is the 12px gaps between tiles.
    <div
      ref={wrapperRef}
      style={{ padding: `${PADDING_PX}px` }}
      onPointerDown={marqueeEnabled ? beginMarquee : undefined}
      onPointerMove={marqueeEnabled ? updateMarquee : undefined}
      onPointerUp={marqueeEnabled ? endMarquee : undefined}
      onPointerCancel={marqueeEnabled ? endMarquee : undefined}
      // A modifier means box-select — never start a native card drag under it.
      onDragStartCapture={
        marqueeEnabled
          ? (event) => {
              if (event.shiftKey || event.metaKey || event.ctrlKey) {
                event.preventDefault();
              }
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
    >
      <div
        ref={(node) => {
          gridRef(node);
          containerRef.current = node;
        }}
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
                  onUnpack={onBeatUnpack}
                  onDelete={onBeatDelete}
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
          if (image.galleryItemType === "collection" && onCollectionOpen) {
            return (
              <div key={image.id} style={tileStyle}>
                <CollectionStackCard
                  collection={{
                    id: image.id,
                    collectionId: image.galleryItemId ?? image.id,
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
                  onOpen={onCollectionOpen}
                />
              </div>
            );
          }
          return (
            <div
              key={image.id}
              draggable={(canDrag && !boxModifierHeld) || undefined}
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
                starrable={starrable && isAssetCard}
                onToggleStar={onToggleStar}
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
                onRenameCollection={
                  isAssetCard ? onRenameCollection : undefined
                }
                projects={isAssetCard ? projects : undefined}
                onAddToProject={isAssetCard ? onAddAssetToProject : undefined}
                onRemoveTag={isAssetCard ? onRemoveAssetTag : undefined}
                onExcludeFromView={
                  isAssetCard ? onExcludeAssetFromView : undefined
                }
                excludeLabel={excludeLabel}
                excludeFolderId={excludeFolderId}
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
