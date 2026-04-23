"use client";

import Image from "next/image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ImageIcon, Loader2, Play, Trash2 } from "lucide-react";
import { useCoralToastSafe } from "@/components/ui/coral-toast";

interface ImageCardProps {
  image: {
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
  };
  eager?: boolean;
  onSelect?: (image: {
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
  selectedId?: string;
  initiallyLoaded?: boolean;
  onLoad?: () => void;
  index?: number;
  canDelete?: boolean;
  deleting?: boolean;
  exiting?: boolean;
  onDelete?: (imageId: string) => void;
}

const PILLAR_META = {
  creators: { label: "Creators", color: "var(--pillar-creators)" },
  cars: { label: "Cars", color: "var(--pillar-cars)" },
  designs: { label: "Designs", color: "var(--pillar-designs)" },
  dump: { label: "Dump", color: "var(--pillar-dump)" },
} as const;

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
  const [isLoading, setIsLoading] = useState(!initiallyLoaded);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(image.src);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [previewCycling, setPreviewCycling] = useState(false);
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

  const aspectRatio = useMemo(() => {
    if (!image.width || !image.height) return "1 / 1";
    return `${image.width} / ${image.height}`;
  }, [image.height, image.width]);

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
      onLoad?.();
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

  const responsiveSizes =
    "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw";

  const entranceDelay = index < 12 ? `${index * 30}ms` : "0ms";
  const pillarMeta = image.pillar
    ? PILLAR_META[image.pillar as keyof typeof PILLAR_META]
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
        : "ASSET ID COPIED";

  const isVideo = image.kind === "video";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasThumb = Boolean(image.src) && image.src !== image.fullSrc;

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

  const cardClasses = [
    "group relative cursor-pointer overflow-hidden rounded-xl animate-card-entrance card-base",
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

  return (
    <div
      className={cardClasses}
      style={{
        aspectRatio,
        animationDelay: entranceDelay,
        animationFillMode: "backwards",
      }}
      onClick={selectImage}
      onMouseEnter={() => {
        if (previewImages.length > 1) {
          setPreviewCycling(true);
        }
        if (isVideo && videoRef.current) {
          videoRef.current.play().catch(() => {});
        }
      }}
      onMouseLeave={() => {
        setPreviewCycling(false);
        setActivePreviewIndex(0);
        if (isVideo && videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
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
          <video
            ref={videoRef}
            src={image.fullSrc}
            muted
            loop
            playsInline
            preload="metadata"
            poster={hasThumb ? image.src : undefined}
            className="h-full w-full object-cover"
            onLoadedData={() => {
              setIsLoading(false);
              onLoad?.();
            }}
            onError={() => {
              setHasError(true);
              setIsLoading(false);
            }}
          />
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

      {/* Video play badge — top-left, always visible */}
      {isVideo && (
        <div
          className="pointer-events-none absolute left-11 top-2 z-10 flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
          style={{
            backgroundColor: "var(--image-card-badge-bg)",
            color: "var(--coral)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border:
              "1px solid color-mix(in srgb, var(--coral) 42%, transparent)",
          }}
        >
          <Play className="h-2.5 w-2.5" fill="currentColor" />
          VIDEO
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
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
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
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border:
              "1px solid color-mix(in srgb, var(--coral) 42%, transparent)",
          }}
        >
          ▤ {image.packMemberCount}
        </div>
      )}

      {/* Model + pillar badges — bottom-left, always visible */}
      {(image.modelName || pillarMeta) && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 transition-opacity duration-[var(--duration-normal)] group-hover:opacity-0">
          {image.modelName && (
            <div
              className="px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: "var(--image-card-badge-bg)",
                color: "var(--image-card-badge-text)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
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
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
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

      {/* Hover overlay — cinematic warm gradient with a feathered prompt sheet */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[var(--duration-normal)] group-hover:pointer-events-auto group-hover:opacity-100"
        style={{
          background: "var(--image-card-overlay-gradient)",
        }}
      >
        <div
          className="absolute bottom-0 left-0 right-0 flex min-h-[50%] flex-col gap-3 overflow-hidden p-3 pt-5"
          style={{
            maxHeight: "62%",
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
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
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
    </div>
  );
});
