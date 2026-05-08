"use client";

import Image from "next/image";
import { memo, useState } from "react";
import { ImageIcon } from "lucide-react";

const PILLAR_META = {
  creators: { label: "Creators", color: "var(--pillar-creators)" },
  designs: { label: "Designs", color: "var(--pillar-designs)" },
  dump: { label: "Dump", color: "var(--pillar-dump)" },
} as const;

export type CanvasImageNodeData = {
  imageId: string;
  src: string;
  fullSrc: string;
  prompt: string;
  width?: number;
  height?: number;
  modelName?: string;
  pillar?: string;
  tagNames?: string[];
  sourceUrl?: string;
  createdAt?: number;
  folderId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
};

const NODE_WIDTH = 200;

export const CanvasImageNode = memo(function CanvasImageNode({
  data,
  selected,
}: {
  data: CanvasImageNodeData;
  selected?: boolean;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(data.src);

  const aspectRatio =
    data.width && data.height ? data.width / data.height : 1;
  const nodeHeight = Math.round(NODE_WIDTH / aspectRatio);

  const pillarMeta = data.pillar
    ? PILLAR_META[data.pillar as keyof typeof PILLAR_META]
    : undefined;

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.naturalWidth > 0) {
      setIsLoading(false);
      setHasError(false);
    }
  };

  const handleError = () => {
    if (currentSrc !== data.fullSrc) {
      setCurrentSrc(data.fullSrc);
      setIsLoading(true);
      setHasError(false);
      return;
    }
    setHasError(true);
    setIsLoading(false);
  };

  return (
    <div
      className="canvas-image-node group overflow-hidden rounded-xl"
      style={{
        width: NODE_WIDTH,
        height: nodeHeight,
        boxShadow: selected
          ? `0 0 0 2px ${pillarMeta?.color ?? "var(--coral)"}, var(--shadow-md)`
          : "var(--shadow-sm)",
        transition: "box-shadow 150ms ease",
        cursor: "pointer",
      }}
    >
      {/* Loading/error state */}
      {(isLoading || hasError) && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: "var(--surface-1)" }}
        >
          <ImageIcon
            className="h-5 w-5"
            style={{ color: "var(--text-ghost)" }}
          />
        </div>
      )}

      {/* Image */}
      <div className="relative h-full w-full">
        <Image
          src={currentSrc || "/placeholder.svg"}
          alt={data.prompt || "Gallery image"}
          fill
          sizes={`${NODE_WIDTH}px`}
          className={`object-cover transition-transform duration-200 group-hover:scale-[1.03] ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          onLoad={handleLoad}
          onError={handleError}
          unoptimized
          draggable={false}
        />
      </div>

      {/* Model + pillar badges */}
      {(data.modelName || pillarMeta) && (
        <div className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1">
          {data.modelName && (
            <div
              className="px-1.5 py-px text-[8px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: "var(--image-card-badge-bg)",
                color: "var(--image-card-badge-text)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid var(--image-card-badge-border)",
              }}
            >
              {data.modelName}
            </div>
          )}
          {pillarMeta && (
            <div
              className="inline-flex items-center gap-0.5 px-1.5 py-px text-[8px] font-mono font-medium uppercase tracking-wider"
              style={{
                backgroundColor: "var(--image-card-badge-bg-soft)",
                color: pillarMeta.color,
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border: "1px solid var(--image-card-badge-border)",
              }}
            >
              <span
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: pillarMeta.color }}
              />
              {pillarMeta.label}
            </div>
          )}
        </div>
      )}

      {/* Hover overlay with prompt */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background: "var(--image-card-overlay-gradient)",
        }}
      >
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p
            className="text-[9px] font-mono leading-snug tracking-wide"
            style={{
              color: "var(--image-card-overlay-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textShadow: "var(--image-card-text-shadow)",
            }}
          >
            {data.prompt}
          </p>
        </div>
      </div>
    </div>
  );
});
