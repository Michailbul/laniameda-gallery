"use client";

import Image from "next/image";
import { memo, useEffect, useMemo, useState } from "react";
import { ImageIcon, Maximize2 } from "lucide-react";

interface ImageCardProps {
  image: {
    id: string;
    src: string;
    fullSrc: string;
    prompt: string;
    author: string;
    likes: number;
    width?: number;
    height?: number;
    modelName?: string;
    pillar?: string;
    tagNames?: string[];
    sourceUrl?: string;
    createdAt?: number;
  };
  eager?: boolean;
  onSelect?: (image: {
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
  selectedId?: string;
  initiallyLoaded?: boolean;
  onLoad?: () => void;
  index?: number;
}

const PILLAR_META = {
  creators: { label: "Creators", color: "#ff7a64" },
  cars: { label: "Cars", color: "#e5534b" },
  designs: { label: "Designs", color: "#5d6bfa" },
  dump: { label: "Dump", color: "#2eb8b4" },
} as const;

export const ImageCard = memo(function ImageCard({
  image,
  eager = false,
  onSelect,
  selectedId,
  initiallyLoaded = false,
  onLoad,
  index = 0,
}: ImageCardProps) {
  const isSelected = image.id === selectedId;
  const hasSelection = selectedId != null;
  const [isLoading, setIsLoading] = useState(!initiallyLoaded);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(image.src);

  const aspectRatio = useMemo(() => {
    if (!image.width || !image.height) return "1 / 1";
    return `${image.width} / ${image.height}`;
  }, [image.height, image.width]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setCurrentSrc(image.src);
      setIsLoading(!initiallyLoaded);
      setHasError(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [image.src, image.fullSrc, initiallyLoaded]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.naturalWidth > 0) {
      setIsLoading(false);
      setHasError(false);
      onLoad?.();
    }
  };

  const handleImageError = () => {
    if (currentSrc !== image.fullSrc) {
      setCurrentSrc(image.fullSrc);
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

  const selectImage = () =>
    onSelect?.({
      id: image.id,
      thumbSrc: image.src,
      fullSrc: image.fullSrc,
      prompt: image.prompt,
      width: image.width,
      height: image.height,
      modelName: image.modelName,
      pillar: image.pillar,
      tagNames: image.tagNames,
      sourceUrl: image.sourceUrl,
      createdAt: image.createdAt,
    });

  // Focus dimming: selected stays full, others dim when there is a selection
  const dimmed = hasSelection && !isSelected;

  const cardClasses = [
    "group relative cursor-pointer overflow-hidden break-inside-avoid rounded-xl animate-card-entrance card-base",
    isSelected && "card-selected",
    dimmed && "card-dimmed",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cardClasses}
      style={{
        aspectRatio,
        breakInside: "avoid-column",
        animationDelay: entranceDelay,
        animationFillMode: "backwards",
        marginBottom: "12px",
      }}
      onClick={selectImage}
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

      {/* Image */}
      <div className="relative h-full w-full">
        <Image
          src={currentSrc || "/placeholder.svg"}
          alt={image.prompt}
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
      </div>

      {/* Model + pillar badges — bottom-left, always visible */}
      {(image.modelName || pillarMeta) && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
          {image.modelName && (
            <div
              className="px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                color: "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              {image.modelName}
            </div>
          )}
          {pillarMeta && (
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.65)",
                color: pillarMeta.color,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
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

      {/* Hover overlay — cinematic warm gradient with view details */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[var(--duration-normal)] group-hover:pointer-events-auto group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(to top, rgba(8,4,2,0.92) 0%, rgba(17,10,6,0.5) 25%, rgba(8,4,2,0.1) 50%, transparent 100%)",
        }}
      >
        {/* Bottom content */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-3">
          <p
            className="flex-1 pr-2 text-[10px] font-mono leading-snug tracking-wide"
            style={{
              color: "rgba(255, 255, 255, 0.85)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
            }}
          >
            {image.prompt}
          </p>

          {/* View details indicator */}
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center backdrop-blur-xl"
            style={{
              color: "rgba(255,255,255,0.85)",
              backgroundColor: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
});
