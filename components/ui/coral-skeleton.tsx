"use client";

import { cn } from "@/lib/utils";

const SHIMMER_BG =
  "linear-gradient(90deg, transparent 0%, var(--gradient-8) 50%, transparent 100%)";

/* ── SkeletonLine ── */

interface SkeletonLineProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function SkeletonLine({
  width = "100%",
  height = 12,
  className,
}: SkeletonLineProps) {
  return (
    <div
      className={cn("rounded-md", className)}
      style={{
        width,
        height,
        backgroundColor: "var(--surface-1)",
        overflow: "hidden",
      }}
    >
      <div
        className="animate-coral-shimmer h-full w-full"
        style={{
          background: SHIMMER_BG,
          backgroundSize: "200% 100%",
          opacity: 0.35,
        }}
      />
    </div>
  );
}

/* ── SkeletonCard ── */

interface SkeletonCardProps {
  className?: string;
  showAvatar?: boolean;
  showImage?: boolean;
  lines?: number;
}

export function SkeletonCard({
  className,
  showAvatar = true,
  showImage = true,
  lines = 3,
}: SkeletonCardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        className,
      )}
      style={{
        backgroundColor: "var(--surface-0)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {showImage && (
        <div
          className="relative overflow-hidden"
          style={{
            aspectRatio: "16/9",
            backgroundColor: "var(--surface-1)",
          }}
        >
          <div
            className="animate-coral-shimmer h-full w-full"
            style={{
              background: SHIMMER_BG,
              backgroundSize: "200% 100%",
              opacity: 0.35,
            }}
          />
        </div>
      )}
      <div className="flex flex-col gap-3 p-4">
        {showAvatar && (
          <div className="flex items-center gap-3">
            <div
              className="shrink-0 overflow-hidden rounded-full"
              style={{
                width: 32,
                height: 32,
                backgroundColor: "var(--surface-2)",
              }}
            >
              <div
                className="animate-coral-shimmer h-full w-full"
                style={{
                  background: SHIMMER_BG,
                  backgroundSize: "200% 100%",
                  opacity: 0.35,
                }}
              />
            </div>
            <SkeletonLine width="40%" height={10} />
          </div>
        )}
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={i === lines - 1 ? "60%" : "100%"}
            height={10}
          />
        ))}
      </div>
    </div>
  );
}

/* ── SkeletonGrid ── */

const SKELETON_ASPECT_RATIOS = [
  "3/4",
  "1/1",
  "4/5",
  "3/4",
  "16/9",
  "1/1",
  "4/5",
  "3/4",
  "1/1",
  "3/4",
  "4/5",
  "16/9",
];

interface SkeletonGridProps {
  count?: number;
  columnClasses?: string;
  className?: string;
}

export function SkeletonGrid({
  count = 12,
  columnClasses = "columns-2 sm:columns-2 md:columns-3 lg:columns-4 2xl:columns-5",
  className,
}: SkeletonGridProps) {
  return (
    <div
      className={cn(columnClasses, className)}
      style={{ columnGap: "12px", padding: "12px" }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="mb-3 overflow-hidden rounded-xl"
          style={{
            aspectRatio: SKELETON_ASPECT_RATIOS[i % SKELETON_ASPECT_RATIOS.length],
            breakInside: "avoid-column",
            backgroundColor: "var(--surface-1)",
          }}
        >
          <div
            className="animate-coral-shimmer h-full w-full"
            style={{
              background: SHIMMER_BG,
              backgroundSize: "200% 100%",
              opacity: 0.35,
            }}
          />
        </div>
      ))}
    </div>
  );
}
