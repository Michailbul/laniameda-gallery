"use client";

import { memo, useCallback, useState } from "react";
import Image from "next/image";
import { BookOpen } from "lucide-react";

export type StorybookCardData = {
  /** Grid entry id (`storybook:<folderId>`). */
  id: string;
  /** The underlying folder id. */
  storybookId: string;
  name: string;
  count: number;
  previews: Array<{
    id: string;
    src: string;
    width?: number;
    height?: number;
    kind?: "image" | "video";
  }>;
};

interface StorybookCardProps {
  storybook: StorybookCardData;
  eager?: boolean;
  onOpen: (storybookId: string) => void;
}

/**
 * Masonry stack card for a storybook collection: the cover image sits on a
 * fanned deck of the next member images. Hover reveals the storybook name;
 * click opens the expanded storybook modal.
 */
export const StorybookCard = memo(function StorybookCard({
  storybook,
  eager = false,
  onOpen,
}: StorybookCardProps) {
  const [coverLoaded, setCoverLoaded] = useState(false);
  // Cached images can be complete before onLoad wires up — check on mount so
  // the fade-in gate never leaves the cover invisible.
  const coverRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setCoverLoaded(true);
  }, []);
  const cover = storybook.previews[0];
  const backLayers = storybook.previews.slice(1, 3);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(storybook.storybookId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(storybook.storybookId);
        }
      }}
      className="group relative h-full w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]"
      aria-label={`Storybook: ${storybook.name}, ${storybook.count} image${storybook.count === 1 ? "" : "s"}`}
    >
      {/* Fanned deck — member images peeking behind the cover. */}
      {backLayers.map((layer, index) => (
        <div
          key={layer.id}
          className="absolute inset-0 overflow-hidden transition-transform duration-[var(--duration-normal)] ease-out"
          style={{
            borderRadius: "14px",
            border: "1px solid var(--border-default)",
            backgroundColor: "var(--surface-3)",
            transform:
              index === 0
                ? "rotate(-2deg) translate(-5px, 4px) scale(0.985)"
                : "rotate(2.6deg) translate(6px, 6px) scale(0.97)",
            zIndex: index === 0 ? 2 : 1,
          }}
        >
          {/* Plain img: these slivers are tiny and mostly covered. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={layer.src}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
            style={{ opacity: 0.9 }}
            loading="lazy"
          />
        </div>
      ))}

      {/* Cover */}
      <div
        className="absolute inset-0 z-[3] overflow-hidden transition-transform duration-[var(--duration-normal)] ease-out group-hover:-translate-y-[3px]"
        style={{
          borderRadius: "14px",
          border: "2px solid var(--border-strong)",
          backgroundColor: "var(--surface-3)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {cover ? (
          <Image
            ref={coverRef}
            src={cover.src}
            alt={storybook.name}
            fill
            unoptimized
            sizes="(min-width: 1536px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
            priority={eager}
            className="object-cover"
            style={{
              opacity: coverLoaded ? 1 : 0,
              transition:
                "opacity var(--duration-normal) ease, transform var(--duration-slow) ease",
            }}
            onLoad={() => setCoverLoaded(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
            <BookOpen
              className="h-6 w-6"
              style={{ color: "var(--text-ghost)" }}
            />
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {storybook.name}
            </span>
            <span
              className="text-[9px] font-mono uppercase tracking-wider"
              style={{ color: "var(--text-ghost)" }}
            >
              Drop images to begin
            </span>
          </div>
        )}

        {/* Count badge — always visible, matches the pack badge language. */}
        <div
          className="absolute right-2 top-2 z-10 flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
          style={{
            backgroundColor: "var(--image-card-badge-bg)",
            color: "var(--coral)",
            border:
              "1px solid color-mix(in srgb, var(--coral) 42%, transparent)",
          }}
        >
          <BookOpen className="h-2.5 w-2.5" />
          {storybook.count}
        </div>

        {/* Hover reveal — storybook name over a warm gradient. */}
        {cover && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 px-3 pb-3 pt-10 opacity-0 transition-opacity duration-[var(--duration-normal)] group-hover:opacity-100 group-focus-visible:opacity-100"
            style={{
              background:
                "linear-gradient(to top, rgba(10, 8, 5, 0.82) 0%, rgba(10, 8, 5, 0.4) 60%, transparent 100%)",
            }}
          >
            <span
              className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em]"
              style={{ color: "var(--coral)" }}
            >
              Storybook · {storybook.count}{" "}
              {storybook.count === 1 ? "image" : "images"}
            </span>
            <span
              className="text-[13px] font-black uppercase leading-tight tracking-[0.08em]"
              style={{
                color: "#FFF4EA",
                textShadow: "0 1px 4px rgba(0,0,0,0.5)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {storybook.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
