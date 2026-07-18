"use client";

/* eslint-disable @next/next/no-img-element -- stack slivers + peek thumbs are
   tiny raw thumbs; Next Image adds nothing but wrapper overhead here. */

import { memo, useCallback, useState } from "react";
import Image from "next/image";
import { Clapperboard } from "lucide-react";

export type BeatStackCardData = {
  /** Grid entry id (`beat:<folderId>`). */
  id: string;
  /** The underlying direction folder id. */
  beatFolderId: string;
  name: string;
  count: number;
  coverSrc?: string;
  coverKind?: "image" | "video";
  /** Everything inside, cover first — the hover peek fan. */
  peekThumbs: string[];
};

interface BeatStackCardProps {
  beat: BeatStackCardData;
  eager?: boolean;
  onOpen: (beatFolderId: string) => void;
}

/**
 * Masonry stack card for a project beat (a video+stills direction): the cover
 * sits on a fanned deck, and hovering the card fans its contents out as small
 * stacked thumbs along the bottom edge (the same .lm-beat-peek deck the review
 * workspace uses — hover a thumb to zoom it in place, no modal). Click opens
 * the project's review workspace.
 */
export const BeatStackCard = memo(function BeatStackCard({
  beat,
  eager = false,
  onOpen,
}: BeatStackCardProps) {
  const [coverLoaded, setCoverLoaded] = useState(false);
  // Cached images can be complete before onLoad wires up — check on mount so
  // the fade-in gate never leaves the cover invisible.
  const coverRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setCoverLoaded(true);
  }, []);
  const backLayers = beat.peekThumbs.slice(1, 3);
  // A video cover without a poster thumb has to mount a real <video> to paint.
  const coverIsRawVideo =
    beat.coverKind === "video" && /\.(mp4|webm|mov)($|\?)/i.test(beat.coverSrc ?? "");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(beat.beatFolderId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(beat.beatFolderId);
        }
      }}
      className="group relative h-full w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]"
      aria-label={`Beat: ${beat.name}, ${beat.count} asset${beat.count === 1 ? "" : "s"}`}
    >
      {/* Fanned deck — member thumbs peeking behind the cover. */}
      {backLayers.map((src, index) => (
        <div
          key={`${src}-${index}`}
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
          <img
            src={src}
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
        {beat.coverSrc ? (
          coverIsRawVideo ? (
            <video
              src={beat.coverSrc}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            <Image
              ref={coverRef}
              src={beat.coverSrc}
              alt={beat.name}
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
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
            <Clapperboard
              className="h-6 w-6"
              style={{ color: "var(--text-ghost)" }}
            />
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {beat.name}
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
          <Clapperboard className="h-2.5 w-2.5" />
          {beat.count}
        </div>

        {/* Hover reveal — beat name over a warm gradient. */}
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
            Beat · {beat.count} {beat.count === 1 ? "asset" : "assets"}
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
            {beat.name}
          </span>
        </div>

        {/* Peek deck — contents fan out along the bottom edge on hover;
            hovering a thumb zooms it in place (styles: .lm-beat-peek*). */}
        {beat.peekThumbs.length > 1 && (
          <div
            className="lm-beat-peek pointer-events-none absolute inset-x-2 bottom-10 z-20 flex items-end justify-center opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
            aria-hidden
          >
            {beat.peekThumbs.map((src, index) => (
              <div key={`${src}-${index}`} className="lm-beat-peek-slot">
                <img src={src} alt="" loading="lazy" className="lm-beat-peek-thumb" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
