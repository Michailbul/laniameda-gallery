"use client";

import { memo, useCallback, useState } from "react";
import Image from "next/image";
import { FolderOpen } from "lucide-react";

export type CollectionStackCardData = {
  id: string;
  collectionId: string;
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

interface CollectionStackCardProps {
  collection: CollectionStackCardData;
  eager?: boolean;
  onOpen: (collectionId: string) => void;
}

/**
 * A child collection represented in the media grid as a visual stack. It is
 * intentionally parallel to storybook and beat cards: the entry opens the
 * child collection instead of the asset detail panel.
 */
export const CollectionStackCard = memo(function CollectionStackCard({
  collection,
  eager = false,
  onOpen,
}: CollectionStackCardProps) {
  const [coverLoaded, setCoverLoaded] = useState(false);
  const coverRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setCoverLoaded(true);
  }, []);
  const cover = collection.previews[0];
  const backLayers = collection.previews.slice(1, 3);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(collection.collectionId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(collection.collectionId);
        }
      }}
      className="group relative h-full w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]"
      aria-label={`Collection: ${collection.name}, ${collection.count} image${collection.count === 1 ? "" : "s"}`}
    >
      {backLayers.map((layer, index) => (
        <div
          key={layer.id}
          aria-hidden
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={layer.src}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ))}

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
            alt={collection.name}
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
            <FolderOpen
              className="h-6 w-6"
              style={{ color: "var(--text-ghost)" }}
            />
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {collection.name}
            </span>
          </div>
        )}

        <div
          className="absolute right-2 top-2 z-10 flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider"
          style={{
            backgroundColor: "var(--image-card-badge-bg)",
            color: "var(--coral)",
            border:
              "1px solid color-mix(in srgb, var(--coral) 42%, transparent)",
          }}
        >
          <FolderOpen className="h-2.5 w-2.5" />
          {collection.count}
        </div>

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
              Collection · {collection.count}{" "}
              {collection.count === 1 ? "image" : "images"}
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
              {collection.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
