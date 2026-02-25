"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Paintbrush, Move, UserRound } from "lucide-react";

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
  };
  eager?: boolean;
  onSelect?: (image: {
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  }) => void;
  selectedId?: string;
  initiallyLoaded?: boolean;
  onLoad?: () => void;
  index?: number;
}

const PILLAR_META = {
  creators: { label: "Creators", color: "#f5d0aa" },
  cars: { label: "Cars", color: "#f97316" },
  designs: { label: "Designs", color: "#60a5fa" },
  dump: { label: "Dump", color: "#9ca3af" },
} as const;

export function ImageCard({
  image,
  eager = false,
  onSelect,
  selectedId,
  initiallyLoaded = false,
  onLoad,
  index = 0,
}: ImageCardProps) {
  const isSelected = image.id === selectedId;
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

  const handleLoadingComplete = () => {
    setIsLoading(false);
    setHasError(false);
    onLoad?.();
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
    });

  return (
    <div
      className="group relative cursor-pointer overflow-hidden break-inside-avoid animate-card-entrance rounded-xl transition-all"
      style={{
        aspectRatio,
        breakInside: "avoid-column",
        animationDelay: entranceDelay,
        animationFillMode: "backwards",
        marginBottom: "12px",
        transitionDuration: "var(--duration-normal)",
        transitionProperty: "transform, box-shadow, opacity",
        boxShadow: isSelected
          ? "0 0 0 2px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.5), 0 0 20px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.15)"
          : "0 2px 8px rgba(0, 0, 0, 0.2)",
        opacity: isSelected ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-4px) scale(1.01)";
        e.currentTarget.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.15), 0 0 30px rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0) scale(1)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.2)";
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
                className="text-[11px]"
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
          className={`object-cover transition-transform group-hover:scale-[1.03] ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          style={{
            transitionDuration: "200ms",
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          onLoadingComplete={handleLoadingComplete}
          onError={handleImageError}
          unoptimized
        />
      </div>

      {/* Model + pillar badges — bottom-left, always visible */}
      {(image.modelName || pillarMeta) && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
          {image.modelName && (
            <div
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.6)",
                color: "rgba(255, 255, 255, 0.85)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              {image.modelName}
            </div>
          )}
          {pillarMeta && (
            <div
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.55)",
                color: pillarMeta.color,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
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

      {/* Hover overlay — cinematic warm gradient */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(to top, rgba(8,4,2,0.92) 0%, rgba(17,10,6,0.5) 25%, rgba(8,4,2,0.1) 50%, transparent 100%)",
          transitionDuration: "var(--duration-normal)",
        }}
      >
        {/* Gradient border ring on hover */}
        <div
          className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            background: "linear-gradient(135deg, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.25), rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.1), rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.2))",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "exclude",
            WebkitMaskComposite: "xor",
            padding: "1.5px",
            borderRadius: "inherit",
            transitionDuration: "var(--duration-normal)",
          }}
        />
        {/* Warm inner glow from bottom */}
        <div
          className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            boxShadow: "inset 0 -20px 40px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.04)",
            transitionDuration: "var(--duration-normal)",
          }}
        />

        {/* Bottom content */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-3">
          <p
            className="flex-1 pr-2 text-[11px] leading-snug"
            style={{
              color: "var(--text-primary)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
            }}
          >
            {image.prompt}
          </p>

          {/* Glass action buttons */}
          <div className="flex items-center gap-1">
            {[
              { icon: Paintbrush, label: "Transfer Style" },
              { icon: Move, label: "Transfer Pose" },
              { icon: UserRound, label: "Replace Character" },
            ].map(({ icon: Icon, label }) => (
              <button
                key={label}
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
                style={{
                  color: "rgba(255,255,255,0.75)",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  transitionDuration: "var(--duration-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--amber-contrast)";
                  e.currentTarget.style.background = "linear-gradient(135deg, var(--amber-9), var(--warm-accent))";
                  e.currentTarget.style.borderColor = "transparent";
                  e.currentTarget.style.boxShadow = "0 0 12px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "rgba(255,255,255,0.75)";
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.boxShadow = "none";
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectImage();
                }}
                aria-label={label}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
