"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useMemo } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { useColumnCount, useContentWidth } from "@/components/masonry-grid";
import {
  DEFAULT_GAP_PX,
  layoutJustified,
  type JustifiedTile,
} from "@/lib/masonry-layout";
import { assetThumb } from "./types";

export type WorldSummary = FunctionReturnType<
  typeof api.showcase.getShowcaseHome
>["worlds"][number];

/**
 * The worlds, in the same justified masonry the Featured and Browse grids
 * use: rows fill the width edge to edge, and every cover keeps its own aspect.
 *
 * The row math mirrors MasonryGrid's, so the size slider means the same thing
 * here as on the other two views. World cards carry a title, logline and
 * section counts, so the type scales with the tile instead of the viewport.
 */
export function WorldsMasonry({
  worlds,
  zoom = 1,
  baseScale = 1.5,
}: {
  worlds: WorldSummary[];
  /** Tile size factor, 0.4–1 — the grid's own zoom. */
  zoom?: number;
  /** Multiplies the full size `zoom` scales from. */
  baseScale?: number;
}) {
  const [attachRef, contentWidth] = useContentWidth();
  const columnCount = useColumnCount(false);
  const gap = DEFAULT_GAP_PX;

  const layout = useMemo(() => {
    if (!contentWidth) return null;
    const effectiveZoom = Math.min(1, Math.max(0.4, zoom));
    const targetRowHeight =
      ((contentWidth - gap * (columnCount - 1)) / columnCount) *
      effectiveZoom *
      baseScale;
    return layoutJustified(
      worlds.map((world) => ({
        width: world.cover?.width ?? world.cover?.thumbWidth,
        height: world.cover?.height ?? world.cover?.thumbHeight,
        kind: world.cover?.kind,
        contentType: world.cover?.contentType,
      })),
      { containerWidth: contentWidth, gap, targetRowHeight },
    );
  }, [contentWidth, columnCount, gap, worlds, zoom, baseScale]);

  return (
    <div
      ref={attachRef}
      style={{
        position: "relative",
        width: "100%",
        height: layout ? layout.totalHeight : undefined,
      }}
    >
      {layout &&
        worlds.map((world, index) => {
          const tile = layout.tiles[index];
          if (!tile) return null;
          return <WorldCard key={world.folderId} world={world} tile={tile} />;
        })}
    </div>
  );
}

// One wide card: cover, name, logline, and the section counts that say how
// much is behind it. Sized by its tile, not the viewport.
function WorldCard({ world, tile }: { world: WorldSummary; tile: JustifiedTile }) {
  const coverSrc = world.cover ? assetThumb(world.cover) : undefined;
  // Narrow tiles (the slider at its smallest, or a phone) keep the title and
  // drop the logline and counts so the cover still shows through.
  const compact = tile.width < 360;
  const titleSize = Math.round(Math.min(56, Math.max(18, tile.width * 0.075)));
  const inset = Math.round(Math.min(38, Math.max(14, tile.width * 0.05)));
  return (
    <Link
      href={`/w/${world.slug ?? world.folderId}`}
      className="lm-world-card"
      style={{
        position: "absolute",
        top: tile.top,
        left: tile.left,
        width: tile.width,
        height: tile.height,
        display: "block",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--lm-surface-2)",
        textDecoration: "none",
        // Card text always sits over the cover's dark gradient, never over the
        // page background — so it stays light regardless of theme.
        color: "#f5ede4",
      }}
    >
      {coverSrc &&
        (world.cover?.kind === "video" ? (
          <video
            src={world.cover.url}
            poster={world.cover.thumbUrl}
            muted
            loop
            playsInline
            autoPlay
            style={coverStyle}
          />
        ) : (
          <img src={coverSrc} alt="" loading="lazy" style={coverStyle} />
        ))}
      {/* Keeps the title legible over any cover. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.1) 100%)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: inset,
          right: inset,
          bottom: Math.round(inset * 0.9),
          display: "block",
        }}
      >
        <span
          style={{
            display: "block",
            fontFamily: "var(--lm-font-display)",
            fontWeight: 800,
            fontSize: titleSize,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: "#f5ede4",
            textShadow: "0 2px 24px rgba(0,0,0,0.6)",
          }}
        >
          {world.name}
        </span>
        {!compact && world.logline && (
          <span
            className="lm-clamp-2"
            style={{
              marginTop: 10,
              maxWidth: 560,
              fontFamily: "var(--lm-font)",
              fontSize: 13,
              lineHeight: 1.55,
              color: "rgba(240, 232, 224, 0.86)",
              textShadow: "0 1px 12px rgba(0,0,0,0.6)",
            }}
          >
            {world.logline}
          </span>
        )}
        <span
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 18px",
            marginTop: compact ? 8 : 14,
            fontFamily: "var(--lm-font)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(240, 232, 224, 0.72)",
          }}
        >
          {!compact &&
            world.sections.map((section) => (
              <span key={section.key}>
                {section.count} {section.label}
              </span>
            ))}
          <span style={{ color: "var(--lm-coral)" }}>Enter →</span>
        </span>
      </span>
    </Link>
  );
}

const coverStyle = {
  position: "absolute" as const,
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover" as const,
};
