"use client";

import Image from "next/image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Copy, ImageIcon, Loader2, Play, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { resolveLayoutAspect } from "@/lib/masonry-layout";

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
    galleryItemType?: "asset" | "pack" | "design" | "workflow";
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
    isPublic?: boolean;
    isFeatured?: boolean;
    packMemberCount?: number;
    size?: number;
    totalSize?: number;
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
  };
  eager?: boolean;
  onSelect?: (image: {
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
  selectedId?: string;
  initiallyLoaded?: boolean;
  onLoad?: (imageId: string) => void;
  index?: number;
  canDelete?: boolean;
  deleting?: boolean;
  exiting?: boolean;
  onDelete?: (imageId: string) => void;
}

const PILLAR_META = {
  creators: { label: "Creators", color: "var(--pillar-creators)" },
  designs: { label: "Designs", color: "var(--pillar-designs)" },
  dump: { label: "Dump", color: "var(--pillar-dump)" },
} as const;

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
        },
      ];
  const activePreview =
    previewImages[activePreviewIndex] ?? previewImages[0]!;

  const activeKind = activePreview.kind ?? image.kind;
  const activeThumbSrc = activePreview.src || image.src;
  const activeFullSrc = activePreview.fullSrc || image.fullSrc;
  const isVideo = activeKind === "video";
  const slotKind = image.kind ?? activeKind;

  // Stable card slot: the grid and card share the same native media aspect so
  // hover playback never changes masonry geometry or crops video format.
  const aspectRatio = useMemo(() => {
    return String(
      resolveLayoutAspect({
        width: image.width,
        height: image.height,
        kind: slotKind,
      }),
    );
  }, [image.height, image.width, slotKind]);

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
  const pillarMeta = image.pillar
    ? PILLAR_META[image.pillar as keyof typeof PILLAR_META] ?? {
        label: image.pillar,
        color: "var(--pillar-dump)",
      }
    : undefined;
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
      previewImages,
    });

  // Focus dimming: selected stays full, others dim when there is a selection
  const dimmed = hasSelection && !isSelected;

  const shouldAnimateEntrance = index < ENTRANCE_ANIMATION_LIMIT;
  const cardClasses = [
    "group relative h-full w-full cursor-pointer overflow-hidden card-base rounded-xl",
    shouldAnimateEntrance && "animate-card-entrance",
    isSelected && "card-selected",
    dimmed && "card-dimmed",
    exiting && "animate-card-exit",
  ].filter(Boolean).join(" ");

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
          <div className="workflow-card-header-stamp">RECIPE</div>
        </div>

        <div
          className="workflow-card-media"
          style={{ aspectRatio }}
        >
          {(isLoading || hasError) && (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: "var(--surface-1)" }}
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
      onClick={selectImage}
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
      }}
    >
      {/* Skeleton / Loading */}
      {(isLoading || hasError) && (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: "var(--surface-1)" }}
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

      {/* Video play mark — icon-only so video cards are identifiable without a text tag. */}
      {isVideo && (
        <div
          className="pointer-events-none absolute bottom-2 right-2 z-20 grid h-9 w-9 place-items-center rounded-full backdrop-blur-md transition-transform duration-200 group-hover:scale-105"
          style={{
            background:
              "linear-gradient(135deg, var(--image-card-badge-bg), var(--image-card-badge-bg-soft))",
            color: "var(--primary-foreground)",
            border:
              "1px solid color-mix(in srgb, var(--primary-foreground) 62%, transparent)",
            boxShadow:
              "0 10px 24px color-mix(in srgb, var(--text-primary) 32%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--primary-foreground) 14%, transparent)",
          }}
        >
          <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
        </div>
      )}

      <button
        type="button"
        onClick={(event) => {
          void handleIdCopy(event);
        }}
        className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center border opacity-0 transition-all duration-[var(--duration-fast)] group-hover:opacity-100 focus-visible:opacity-100"
        style={{
          borderRadius: "8px",
          backgroundColor: "var(--image-card-badge-bg)",
          color: "var(--image-card-badge-text)",
          borderColor: "var(--image-card-badge-border)",
        }}
        aria-label={`Copy ${galleryItemType} ID`}
        title={`Copy ${galleryItemType} ID`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>

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

      {/* Model + pillar badges — bottom-left, always visible. Suppressed on cinema-inspiration. */}
      {!isCinema && (image.modelName || pillarMeta) && (
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
          {pillarMeta && (
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: "var(--image-card-badge-bg-soft)",
                color: pillarMeta.color,
                border: "1px solid var(--image-card-badge-border)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: pillarMeta.color }}
              />
              {pillarMeta.label}
            </div>
          )}
        </div>
      )}

      {/* Hover overlay — cinematic warm gradient with a feathered prompt sheet. Suppressed on cinema. */}
      {!isCinema && (
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[var(--duration-normal)] group-hover:pointer-events-auto group-hover:opacity-100"
        style={{
          background: "var(--image-card-overlay-gradient)",
        }}
      >
        <div
          className={`absolute bottom-0 left-0 right-0 flex flex-col gap-3 overflow-hidden p-3 pt-5 ${
            isVideo ? "min-h-[25%]" : "min-h-[50%]"
          }`}
          style={{
            maxHeight: isVideo ? "31%" : "62%",
          }}
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

      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-[var(--duration-fast)] disabled:cursor-not-allowed"
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
    </motion.div>
  );
});
