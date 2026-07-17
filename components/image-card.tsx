"use client";

import Image from "next/image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Download, Heart, ImageIcon, Loader2, Play, Quote, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { resolveLayoutAspect, resolveLayoutKind } from "@/lib/masonry-layout";
import { downloadAssetFile } from "@/lib/download-image";
import { hasMeaningfulPrompt } from "@/lib/prompt";
import {
  CardCollectionButton,
  type CollectionOption,
} from "@/components/collection-menu";

const CINEMA_PILLAR = "cinema-inspiration";

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

interface ImageCardProps {
  image: {
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
    size?: number;
    totalSize?: number;
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
  };
  eager?: boolean;
  onSelect?: (image: {
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
  selectedId?: string;
  initiallyLoaded?: boolean;
  onLoad?: (imageId: string) => void;
  index?: number;
  canDelete?: boolean;
  deleting?: boolean;
  exiting?: boolean;
  onDelete?: (imageId: string) => void;
  selectable?: boolean;
  selected?: boolean;
  /** True when a multi-selection is in progress — a plain card click then
      toggles selection instead of opening the detail panel. */
  selectionActive?: boolean;
  onToggleSelect?: (imageId: string) => void;
  likeable?: boolean;
  liked?: boolean;
  onToggleLike?: (imageId: string, nextLiked: boolean) => void;
  showPublicBadge?: boolean;
  collections?: CollectionOption[];
  onMoveToCollection?: (imageId: string, folderId: string) => Promise<void> | void;
  onCopyToCollection?: (imageId: string, folderId: string) => Promise<void> | void;
  onRemoveFromCollection?: (imageId: string, folderId: string) => Promise<void> | void;
  onCreateCollection?: (name: string) => Promise<string | null>;
  /** Projects the asset can be sent to via the collection menu (→ Inbox). */
  projects?: CollectionOption[];
  onAddToProject?: (imageId: string, projectId: string) => Promise<void> | void;
}

const VIDEO_HOVER_DELAY_MS = 250;
const ENABLE_VIDEO_HOVER_PLAYBACK = true;
const ENTRANCE_ANIMATION_LIMIT = 12;

// Module-level singleton: only one card video plays at a time. When a new card
// starts hover-playback it pauses any previous one — prevents a "swept cursor"
// from stacking concurrent decodes.
let activeHoverVideo: HTMLVideoElement | null = null;
function claimActiveHoverVideo(next: HTMLVideoElement | null) {
  if (activeHoverVideo && activeHoverVideo !== next) {
    activeHoverVideo.pause();
    activeHoverVideo.currentTime = 0;
  }
  activeHoverVideo = next;
}

export const ImageCard = memo(function ImageCard({
  image,
  eager = false,
  onSelect,
  selectedId,
  initiallyLoaded = false,
  onLoad,
  index = 0,
  canDelete = false,
  deleting = false,
  exiting = false,
  onDelete,
  selectable = false,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  likeable = false,
  liked = false,
  onToggleLike,
  showPublicBadge = false,
  collections,
  onMoveToCollection,
  onCopyToCollection,
  onRemoveFromCollection,
  onCreateCollection,
  projects,
  onAddToProject,
}: ImageCardProps) {
  const isSelected = image.id === selectedId;
  const hasSelection = selectedId != null;
  const isCinema = image.pillar === CINEMA_PILLAR;
  const cinemaMeta = isCinema ? image.cinemaMetadata ?? undefined : undefined;
  const [isLoading, setIsLoading] = useState(!initiallyLoaded);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(image.src);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [previewCycling, setPreviewCycling] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const coralCtx = useCoralToastSafe();
  const toastFn = coralCtx?.toast;

  const previewImages = image.previewImages.length > 0
    ? image.previewImages
    : [
        {
          id: image.id,
          galleryItemId: image.id,
          galleryItemType: "asset" as const,
          src: image.src,
          fullSrc: image.fullSrc,
          prompt: image.prompt,
          width: image.width,
          height: image.height,
          kind: image.kind,
          contentType: image.contentType,
        },
      ];
  const activePreview =
    previewImages[activePreviewIndex] ?? previewImages[0]!;
  const layoutPreview = previewImages[0]!;

  const activeKind = activePreview.kind ?? image.kind;
  const activeContentType = activePreview.contentType ?? image.contentType;
  const activeThumbSrc = activePreview.src || image.src;
  const activeFullSrc = activePreview.fullSrc || image.fullSrc;
  const isVideo =
    resolveLayoutKind({
      kind: activeKind,
      contentType: activeContentType,
    }) === "video";
  const slotKind = layoutPreview.kind ?? image.kind;
  const slotContentType = layoutPreview.contentType ?? image.contentType;

  // Stable card slot: the grid and card share the same native media aspect so
  // hover playback never changes masonry geometry or crops video format.
  const aspectRatio = useMemo(() => {
    return String(
      resolveLayoutAspect({
        width: layoutPreview.width ?? image.width,
        height: layoutPreview.height ?? image.height,
        kind: slotKind,
        contentType: slotContentType,
      }),
    );
  }, [
    image.height,
    image.width,
    layoutPreview.height,
    layoutPreview.width,
    slotContentType,
    slotKind,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setCurrentSrc(activePreview.src);
      setIsLoading(!initiallyLoaded || activePreviewIndex > 0);
      setHasError(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [activePreview.src, activePreviewIndex, initiallyLoaded]);

  useEffect(() => {
    if (!previewCycling || previewImages.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setActivePreviewIndex((current) => (current + 1) % previewImages.length);
    }, 650);

    return () => window.clearInterval(interval);
  }, [previewCycling, previewImages.length]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.naturalWidth > 0) {
      setIsLoading(false);
      setHasError(false);
      onLoad?.(image.id);
    }
  };

  const handleImageError = () => {
    if (currentSrc !== activePreview.fullSrc) {
      setCurrentSrc(activePreview.fullSrc);
      setIsLoading(true);
      setHasError(false);
      return;
    }
    setHasError(true);
    setIsLoading(false);
  };

  const handleVideoPosterError = () => {
    setIsLoading(false);
  };

  const responsiveSizes = isVideo
    ? "(max-width: 640px) 100vw, (max-width: 1024px) 66vw, (max-width: 1280px) 50vw, 40vw"
    : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw";

  const entranceDelay =
    index < ENTRANCE_ANIMATION_LIMIT ? `${index * 30}ms` : "0ms";
  const galleryItemType =
    image.galleryItemType ?? (image.packId ? "pack" : "asset");
  const galleryItemId =
    image.galleryItemId ??
    (galleryItemType === "pack" ? image.packId ?? image.id : image.id);
  const galleryCopyToken = `${galleryItemType}:${galleryItemId}`;
  const galleryCopyLabel =
    galleryItemType === "pack"
      ? "PACK ID COPIED"
      : galleryItemType === "design"
        ? "DESIGN ID COPIED"
        : galleryItemType === "workflow"
          ? "WORKFLOW ID COPIED"
          : "ASSET ID COPIED";
  const isWorkflow = galleryItemType === "workflow";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoHoverTimerRef = useRef<number | null>(null);
  const hasThumb = Boolean(activeThumbSrc) && activeThumbSrc !== activeFullSrc;

  const clearVideoHoverTimer = useCallback(() => {
    if (videoHoverTimerRef.current === null) {
      return;
    }
    window.clearTimeout(videoHoverTimerRef.current);
    videoHoverTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!isVideo || !videoActive || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    const play = () => {
      claimActiveHoverVideo(video);
      void video.play().catch(() => {});
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      play();
      return;
    }

    video.addEventListener("loadeddata", play, { once: true });
    return () => video.removeEventListener("loadeddata", play);
  }, [activeFullSrc, isVideo, videoActive]);

  useEffect(() => clearVideoHoverTimer, [clearVideoHoverTimer]);

  // Release the module-level singleton on unmount so the global ref doesn't
  // outlive a detached <video>. Reading videoRef.current at unmount time is
  // intentional — we need the latest ref, which is exactly what the linter
  // warning is about.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const video = videoRef.current;
      if (!video) return;
      if (activeHoverVideo === video) {
        claimActiveHoverVideo(null);
      } else {
        video.pause();
      }
    };
  }, []);

  const selectImage = () =>
    onSelect?.({
      id: image.id,
      packId: image.packId,
      galleryItemId,
      galleryItemType,
      thumbSrc: image.src,
      fullSrc: image.fullSrc,
      prompt: image.prompt,
      width: image.width,
      height: image.height,
      kind: image.kind,
      contentType: image.contentType,
      modelName: image.modelName,
      pillar: image.pillar,
      tagNames: image.tagNames,
      sourceUrl: image.sourceUrl,
      createdAt: image.createdAt,
      folderId: image.folderId,
      isPublic: image.isPublic,
      isFeatured: image.isFeatured,
      isLiked: image.isLiked,
      previewImages,
    });

  // A click on the card body opens the detail panel — UNLESS a multi-selection
  // is underway (or the user holds a modifier), in which case it toggles this
  // card's selection so any part of the card is a select target.
  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      selectable &&
      onToggleSelect &&
      (selectionActive || event.shiftKey || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      onToggleSelect(image.id);
      return;
    }
    selectImage();
  };

  // Focus dimming: selected stays full, others dim when there is a selection
  const dimmed = hasSelection && !isSelected;

  const shouldAnimateEntrance = index < ENTRANCE_ANIMATION_LIMIT;
  const cardClasses = [
    "group relative h-full w-full cursor-pointer overflow-hidden card-base rounded-xl",
    shouldAnimateEntrance && "animate-card-entrance",
    isSelected && "card-selected",
    dimmed && "card-dimmed",
    exiting && "animate-card-exit",
    selectable && selected && "ring-2 ring-[var(--lm-coral)] ring-offset-2 ring-offset-[var(--lm-surface-0)]",
  ].filter(Boolean).join(" ");

  const handleToggleSelect = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleSelect?.(image.id);
  };

  const handleToggleLike = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleLike?.(image.id, !liked);
  };

  const handleDownload = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (downloading) return;
      setDownloading(true);
      try {
        const ok = await downloadAssetFile({
          url: image.fullSrc || image.src,
          baseName: image.id,
          isImage: !isVideo,
        });
        if (ok) {
          toastFn?.("Downloaded", isVideo ? "FILE SAVED" : "JPG SAVED", "success");
        }
      } finally {
        setDownloading(false);
      }
    },
    [downloading, image.fullSrc, image.src, image.id, isVideo, toastFn],
  );

  const handleDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (deleting) return;
    onDelete?.(image.id);
  };

  const handlePromptCopy = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      await navigator.clipboard.writeText(image.prompt);
      toastFn?.("Copied", "PROMPT COPIED", "success");
    },
    [image.prompt, toastFn],
  );

  // Prompt sheet visibility: revealed by hovering the "prompt" chip (not the
  // whole card — a card-wide scrollable sheet hijacked wheel scrolling while
  // sweeping through the gallery). A short grace timer lets the pointer
  // travel from the chip into the sheet.
  const [promptOpen, setPromptOpen] = useState(false);
  const promptCloseTimerRef = useRef<number | null>(null);

  const cancelPromptClose = useCallback(() => {
    if (promptCloseTimerRef.current !== null) {
      window.clearTimeout(promptCloseTimerRef.current);
      promptCloseTimerRef.current = null;
    }
  }, []);

  const openPromptSheet = useCallback(() => {
    cancelPromptClose();
    setPromptOpen(true);
  }, [cancelPromptClose]);

  const schedulePromptClose = useCallback(() => {
    cancelPromptClose();
    promptCloseTimerRef.current = window.setTimeout(() => {
      promptCloseTimerRef.current = null;
      setPromptOpen(false);
    }, 160);
  }, [cancelPromptClose]);

  useEffect(() => cancelPromptClose, [cancelPromptClose]);

  // Only surface the PROMPT button when a real prompt exists — placeholder
  // fallbacks ("Untitled prompt", a bare file name) don't count.
  const hasPrompt = hasMeaningfulPrompt(activePreview.prompt);

  const handleIdCopy = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      await navigator.clipboard.writeText(galleryCopyToken);
      toastFn?.("Copied", galleryCopyLabel, "success");
    },
    [galleryCopyLabel, galleryCopyToken, toastFn],
  );

  if (isWorkflow) {
    const workflowCardClasses = [
      "group relative cursor-pointer overflow-hidden workflow-card",
      isSelected && "workflow-card-selected",
      dimmed && "card-dimmed",
      exiting && "animate-card-exit",
      shouldAnimateEntrance && "animate-card-entrance",
    ]
      .filter(Boolean)
      .join(" ");

    const stepLabel =
      typeof image.stepCount === "number" && image.stepCount > 0
        ? `${image.stepCount} ${image.stepCount === 1 ? "step" : "steps"}`
        : "Workflow";

    return (
      <div
        className={workflowCardClasses}
        style={{
          animationDelay: shouldAnimateEntrance ? entranceDelay : undefined,
          animationFillMode: shouldAnimateEntrance ? "backwards" : undefined,
        }}
        onClick={selectImage}
        onMouseEnter={() => {
          if (previewImages.length > 1) {
            setPreviewCycling(true);
          }
        }}
        onMouseLeave={() => {
          setPreviewCycling(false);
          setActivePreviewIndex(0);
        }}
      >
        <div className="workflow-card-header">
          <div className="workflow-card-header-left">
            <WorkflowIcon className="h-3 w-3" strokeWidth={2.5} />
            <span className="workflow-card-header-label">{stepLabel}</span>
          </div>
        </div>

        <div
          className="workflow-card-media"
          style={{ aspectRatio }}
        >
          {(isLoading || hasError) && (
            <div
              className="absolute inset-0"
              style={{
                // Must read as a card against the page background on both
                // themes — a bare --surface-1 is nearly invisible on dark.
                backgroundColor:
                  "color-mix(in srgb, var(--text-primary) 6%, var(--surface-1))",
                boxShadow:
                  "inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 10%, transparent)",
              }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <ImageIcon
                  className="h-6 w-6"
                  style={{ color: "var(--text-ghost)" }}
                />
                {hasError && (
                  <span
                    className="text-[11px] font-mono uppercase tracking-wider"
                    style={{ color: "var(--text-ghost)" }}
                  >
                    Failed to load
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="relative h-full w-full">
            <Image
              src={currentSrc || "/placeholder.svg"}
              alt={activePreview.prompt}
              fill
              sizes={responsiveSizes}
              priority={eager}
              className={`object-cover transition-transform duration-200 group-hover:scale-[1.02] ${
                isLoading ? "opacity-0" : "opacity-100"
              }`}
              style={{
                transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
              unoptimized
            />
            <div className="workflow-card-grid-overlay" aria-hidden />
          </div>

          <button
            type="button"
            onClick={(event) => {
              void handleIdCopy(event);
            }}
            className="workflow-card-copy-btn"
            aria-label="Copy workflow ID"
            title="Copy workflow ID"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>

        <button
          type="button"
          onClick={(event) => {
            void handlePromptCopy(event);
          }}
          className="workflow-card-caption"
          aria-label="Copy workflow description"
        >
          <span className="workflow-card-caption-marker">▸</span>
          <span className="workflow-card-caption-text">{image.prompt}</span>
          <Copy className="workflow-card-caption-copy h-2.5 w-2.5" />
        </button>

        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="workflow-card-delete"
            aria-label={deleting ? "Deleting workflow" : "Delete workflow"}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <motion.div
      layoutId={isCinema ? `cinema-${image.id}` : undefined}
      className={cardClasses}
      style={{
        aspectRatio,
        animationDelay: shouldAnimateEntrance ? entranceDelay : undefined,
        animationFillMode: shouldAnimateEntrance ? "backwards" : undefined,
      }}
      onClick={handleCardClick}
      onMouseEnter={() => {
        if (previewImages.length > 1) {
          setPreviewCycling(true);
        }
        if (isVideo && ENABLE_VIDEO_HOVER_PLAYBACK) {
          clearVideoHoverTimer();
          videoHoverTimerRef.current = window.setTimeout(() => {
            setVideoActive(true);
            videoHoverTimerRef.current = null;
          }, VIDEO_HOVER_DELAY_MS);
        }
      }}
      onMouseLeave={() => {
        setPreviewCycling(false);
        setActivePreviewIndex(0);
        clearVideoHoverTimer();
        if (isVideo && videoRef.current) {
          if (activeHoverVideo === videoRef.current) {
            claimActiveHoverVideo(null);
          } else {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
          }
        }
        setVideoActive(false);
        cancelPromptClose();
        setPromptOpen(false);
      }}
    >
      {/* Skeleton / Loading */}
      {(isLoading || hasError) && (
        <div
          className="absolute inset-0"
          style={{
            // Must read as a card against the page background on both themes
            // — a bare --surface-1 is nearly invisible on dark and made
            // loading cards look like holes in the masonry.
            backgroundColor:
              "color-mix(in srgb, var(--text-primary) 6%, var(--surface-1))",
            boxShadow:
              "inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 10%, transparent)",
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.03) 50%, transparent 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite linear",
            }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <ImageIcon
              className="h-6 w-6"
              style={{ color: "var(--text-ghost)" }}
            />
            {hasError && (
              <span
                className="text-[11px] font-mono uppercase tracking-wider"
                style={{ color: "var(--text-ghost)" }}
              >
                Failed to load
              </span>
            )}
          </div>
        </div>
      )}

      {/* Media */}
      <div className="relative h-full w-full">
        {isVideo ? (
          <>
            {hasThumb && (
              <Image
                src={activeThumbSrc || "/placeholder.svg"}
                alt={activePreview.prompt}
                fill
                sizes={responsiveSizes}
                priority={eager}
                className={`object-contain transition-opacity duration-150 ${
                  isLoading ? "opacity-0" : "opacity-100"
                }`}
                onLoad={handleImageLoad}
                onError={handleVideoPosterError}
                unoptimized
              />
            )}
            {(videoActive || !hasThumb) && (
              <video
                ref={videoRef}
                src={activeFullSrc}
                muted
                loop
                playsInline
                preload={videoActive ? "auto" : "metadata"}
                poster={hasThumb ? activeThumbSrc : undefined}
                className="absolute inset-0 h-full w-full object-contain"
                onLoadedMetadata={(e) => {
                  // Nudge currentTime so the browser actually paints the
                  // first frame as a poster. Without this, Chrome/Safari
                  // leave the slot blank until the video plays.
                  if (!hasThumb && e.currentTarget.currentTime === 0) {
                    e.currentTarget.currentTime = 0.001;
                  }
                }}
                onLoadedData={() => {
                  setIsLoading(false);
                  onLoad?.(image.id);
                }}
                onError={() => {
                  if (!hasThumb) {
                    setHasError(true);
                  }
                  setIsLoading(false);
                }}
              />
            )}
          </>
        ) : (
          <Image
            src={currentSrc || "/placeholder.svg"}
            alt={activePreview.prompt}
            fill
            sizes={responsiveSizes}
            priority={eager}
            className={`object-cover transition-transform duration-200 group-hover:scale-[1.03] ${
              isLoading ? "opacity-0" : "opacity-100"
            }`}
            style={{
              transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onLoad={handleImageLoad}
            onError={handleImageError}
            unoptimized
          />
        )}
      </div>

      {/* Video play mark — a quiet glass chip. It identifies video cards at
          rest and fades away on hover, when the video itself starts playing. */}
      {isVideo && (
        <div
          className="pointer-events-none absolute bottom-2 right-2 z-20 grid h-6 w-6 place-items-center rounded-full backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-0"
          style={{
            background: "var(--image-card-badge-bg)",
            color: "var(--image-card-badge-text)",
            border:
              "1px solid color-mix(in srgb, var(--image-card-badge-text) 25%, transparent)",
          }}
        >
          <Play className="ml-px h-2.5 w-2.5" fill="currentColor" />
        </div>
      )}

      {/* Top-left action cluster — flex keeps the gaps uniform no matter which
          buttons are present. pointer-events-none on the wrapper leaves the
          gaps between buttons click-through to the card underneath. */}
      <div className="card-toolbar pointer-events-none absolute left-2 top-2 z-30 flex items-center gap-1.5">
        {selectable && (
          <button
            type="button"
            onClick={handleToggleSelect}
            className={`card-icon-btn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border ${
              selected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
            data-active={selected ? "dark" : undefined}
            aria-label={selected ? "Deselect asset" : "Select asset"}
            aria-pressed={selected}
            title={selected ? "Deselect" : "Select"}
          >
            {selected ? (
              <Check className="h-4 w-4" strokeWidth={3} />
            ) : (
              <span
                className="block h-3.5 w-3.5"
                style={{
                  border: "1.5px solid currentColor",
                  borderRadius: "4px",
                }}
              />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={(event) => {
            void handleIdCopy(event);
          }}
          className="card-icon-btn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Copy ${galleryItemType} ID`}
          title={`Copy ${galleryItemType} ID`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>

        {/* One-click download — appears on hover. Images save as JPG. */}
        <button
          type="button"
          onClick={(event) => {
            void handleDownload(event);
          }}
          disabled={downloading}
          className="card-icon-btn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
          aria-label={isVideo ? "Download file" : "Download as JPG"}
          title={isVideo ? "Download file" : "Download as JPG"}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Move/copy to collection — hover control with a floating menu. */}
        {collections && onMoveToCollection && onCopyToCollection && (
          <CardCollectionButton
            imageId={image.id}
            currentFolderIds={
              image.folderIds ?? (image.folderId ? [image.folderId] : [])
            }
            collections={collections}
            onMove={onMoveToCollection}
            onCopy={onCopyToCollection}
            onRemove={onRemoveFromCollection}
            onCreate={onCreateCollection}
            projects={projects}
            onAddToProject={onAddToProject}
            positionClassName="pointer-events-auto z-20"
          />
        )}
      </div>

      {/* Pack badge — top-right */}
      {image.packMemberCount !== undefined && image.packMemberCount > 1 && (
        <div
          className="absolute right-2 top-2 z-10 flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
          style={{
            backgroundColor: "var(--image-card-badge-bg)",
            color: "var(--coral)",
            border:
              "1px solid color-mix(in srgb, var(--coral) 42%, transparent)",
          }}
        >
          ▤ {image.packMemberCount}
        </div>
      )}

      {/* Model + public-status badges — bottom-left, always visible. Suppressed on cinema-inspiration. */}
      {!isCinema && (image.modelName || (showPublicBadge && image.isPublic)) && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 transition-opacity duration-[var(--duration-normal)] group-hover:opacity-0">
          {image.modelName && (
            <div
              className="px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: "var(--image-card-badge-bg)",
                color: "var(--image-card-badge-text)",
                border: "1px solid var(--image-card-badge-border)",
              }}
            >
              {image.modelName}
            </div>
          )}
          {showPublicBadge && image.isPublic && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
              style={{
                backgroundColor: "var(--image-card-badge-bg)",
                color: "var(--coral)",
                border: "1px solid color-mix(in srgb, var(--coral) 42%, transparent)",
              }}
              title="Already public"
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--coral)" }}
              />
              Public
            </div>
          )}
        </div>
      )}

      {/* Hover gradient — pure visual (icon legibility); never intercepts the
          pointer, so wheel scrolling passes through the card untouched. */}
      {!isCinema && (
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[var(--duration-normal)] group-hover:opacity-100"
          style={{
            background: "var(--image-card-overlay-gradient)",
          }}
        />
      )}

      {/* "Prompt" chip — bottom-left on card hover. Hovering it reveals the
          prompt sheet; clicking copies the prompt. */}
      {!isCinema && hasPrompt && (
        <button
          type="button"
          onClick={(event) => {
            void handlePromptCopy(event);
          }}
          onMouseEnter={openPromptSheet}
          onMouseLeave={schedulePromptClose}
          onFocus={openPromptSheet}
          onBlur={schedulePromptClose}
          className={`card-icon-btn absolute bottom-2 left-2 z-40 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[9px] font-mono font-bold uppercase tracking-wider ${
            promptOpen
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
          aria-label="Show prompt — click to copy"
          title="Hover to preview, click to copy prompt"
        >
          <Quote className="h-3 w-3" />
          Prompt
        </button>
      )}

      {/* Prompt sheet — feathered blur panel, shown only while hovering the
          chip or the sheet itself. Click anywhere on the text copies. */}
      {!isCinema && hasPrompt && promptOpen && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden p-3 pb-11 pt-5 lm-animate-fade-in"
          style={{ maxHeight: isVideo ? "40%" : "62%" }}
          onMouseEnter={cancelPromptClose}
          onMouseLeave={schedulePromptClose}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: "var(--image-card-prompt-sheet-bg)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              maskImage:
                "linear-gradient(to bottom, transparent 0%, black 32%, black 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, black 32%, black 100%)",
            }}
          />

          <button
            type="button"
            onClick={(event) => {
              void handlePromptCopy(event);
            }}
            className="relative z-10 min-h-0 flex-1 overflow-y-auto pr-2 text-left text-[10px] font-mono leading-snug tracking-wide overscroll-contain"
            style={{
              color: "var(--image-card-overlay-text)",
              textShadow: "var(--image-card-text-shadow)",
              scrollbarWidth: "thin",
            }}
            aria-label="Copy prompt to clipboard"
          >
            {activePreview.prompt}
          </button>
        </div>
      )}

      {/* Cinema hover chip — MOVIE · YEAR — only on cinema-inspiration cards */}
      {isCinema && cinemaMeta && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-start p-3 opacity-0 transition-opacity duration-[var(--duration-normal)] group-hover:opacity-100"
          style={{
            background: "var(--image-card-overlay-gradient)",
          }}
        >
          <div
            className="inline-flex items-center gap-2 px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.16em]"
            style={{
              color: "var(--image-card-overlay-text)",
              textShadow: "var(--image-card-text-shadow)",
            }}
          >
            <span
              className="inline-block h-1 w-1 rounded-full"
              style={{ backgroundColor: "var(--pillar-cinema-inspiration)" }}
            />
            <span className="truncate" style={{ maxWidth: "220px" }}>
              {cinemaMeta.movieTitle}
            </span>
            {cinemaMeta.year && (
              <span style={{ opacity: 0.72 }}>· {cinemaMeta.year}</span>
            )}
          </div>
        </div>
      )}

      {/* Top-right action cluster — destructive/like actions kept apart from
          the left cluster; flex keeps delete and like evenly spaced. */}
      {(canDelete || likeable) && (
        <div className="card-toolbar pointer-events-none absolute right-2 top-2 z-30 flex items-center gap-1.5">
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={`card-icon-btn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border disabled:cursor-not-allowed ${
                deleting
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              }`}
              style={{
                borderColor: deleting
                  ? "var(--image-card-delete-border-disabled)"
                  : "var(--image-card-delete-border)",
                backgroundColor: deleting
                  ? "var(--image-card-delete-bg-disabled)"
                  : "var(--image-card-delete-bg)",
                color: deleting
                  ? "var(--image-card-delete-text-disabled)"
                  : "var(--image-card-delete-text)",
                boxShadow: deleting ? "none" : "var(--image-card-delete-shadow)",
              }}
              aria-label={deleting ? "Deleting image" : "Delete image"}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          )}

          {likeable && (
            <button
              type="button"
              onClick={handleToggleLike}
              className={`card-icon-btn pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border ${
                liked
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              }`}
              data-active={liked ? "light" : undefined}
              aria-label={liked ? "Unlike asset" : "Like asset"}
              aria-pressed={liked}
              title={liked ? "Liked — click to unlike" : "Like"}
            >
              <Heart
                className="h-4 w-4"
                strokeWidth={2.25}
                fill={liked ? "currentColor" : "none"}
              />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
});
