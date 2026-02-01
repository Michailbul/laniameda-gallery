"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ImageIcon } from "lucide-react";

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
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
  }) => void;
  initiallyLoaded?: boolean;
  onLoad?: () => void;
}

export function ImageCard({
  image,
  eager = false,
  onSelect,
  initiallyLoaded = false,
  onLoad,
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
    return () => {
      cancelAnimationFrame(frame);
    };
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
    "(max-width: 640px) 85vw, (max-width: 1024px) 48vw, (max-width: 1280px) 32vw, 24vw";
  return (
    <div
      className="relative group overflow-hidden cursor-pointer break-inside-avoid"
      style={{ aspectRatio, breakInside: "avoid-column" }}
      onClick={() =>
        onSelect?.({
          thumbSrc: image.src,
          fullSrc: image.fullSrc,
          prompt: image.prompt,
          width: image.width,
          height: image.height,
        })
      }
    >
      {/* Skeleton / Loading State */}
      {(isLoading || hasError) && (
        <div className="absolute inset-0 bg-muted">
          <div className="absolute inset-0 bg-gradient-to-br from-muted via-muted-foreground/5 to-muted" />
          <div 
            className="absolute inset-0 animate-pulse"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
            }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
            {hasError && (
              <span className="text-xs text-muted-foreground/60">Failed to load</span>
            )}
          </div>
        </div>
      )}

      <div className="relative h-full w-full">
        <Image
          src={currentSrc || "/placeholder.svg"}
          alt={image.prompt}
          fill
          sizes={responsiveSizes}
          priority={eager}
          className={`object-cover transition-all duration-300 group-hover:scale-[1.02] ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          onLoadingComplete={handleLoadingComplete}
          onError={handleImageError}
          unoptimized
        />
      </div>

      
    </div>
  );
}
