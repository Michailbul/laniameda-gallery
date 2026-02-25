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
  initiallyLoaded?: boolean;
  onLoad?: () => void;
  index?: number;
}

export function ImageCard({
  image,
  eager = false,
  onSelect,
  initiallyLoaded = false,
  onLoad,
  index = 0,
}: ImageCardProps) {
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
        transitionDuration: "var(--duration-fast)",
        transitionProperty: "transform, box-shadow",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
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
                "linear-gradient(90deg, transparent 0%, rgba(230, 255, 42, 0.02) 50%, transparent 100%)",
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

      {/* Hover overlay — cinematic gradient */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.05) 60%, transparent 100%)",
          transitionDuration: "var(--duration-fast)",
        }}
      >
        {/* Soft teal border glow */}
        <div
          className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            boxShadow: "inset 0 0 0 1.5px rgba(230, 255, 42, 0.3), inset 0 0 20px rgba(230, 255, 42, 0.05)",
            transitionDuration: "var(--duration-fast)",
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
                  color: "rgba(255,255,255,0.7)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  transitionDuration: "var(--duration-instant)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--lime-9)";
                  e.currentTarget.style.backgroundColor = "rgba(230, 255, 42, 0.12)";
                  e.currentTarget.style.boxShadow = "0 0 8px rgba(230, 255, 42, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "rgba(255,255,255,0.7)";
                  e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)";
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
