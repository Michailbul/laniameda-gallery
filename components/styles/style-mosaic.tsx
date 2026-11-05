"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { buildGridImageAttrs } from "@/lib/grid-image";
import { display, mono } from "@/components/inbox/inbox-ui";

// One style as a cover: four of its frames in a 2×2 mosaic, its name, frame
// count and medium. Shared by the world page's styles strip and the styles
// page carousel, so a style looks the same wherever it is picked.

export type StyleCardData = FunctionReturnType<typeof api.worldStyles.listStyles>["styles"][number];
type Frame = StyleCardData["covers"][number];

export const MOSAIC_COVERS = 4;

const tileAttrs = (frame: Frame, width: number) => buildGridImageAttrs({
  src: frame.thumbUrl ?? frame.url ?? "",
  variants: frame.variants,
  thumbSrc: frame.thumbUrl, thumbWidth: frame.thumbWidth,
  fullSrc: frame.url, fullWidth: frame.width,
}, width, frame.kind);

export const framesLabel = (count: number, noun = "frame") => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The medium filter order: the film first, then the drawn and built worlds. */
export const orderMedia = (names: string[]) => {
  const rank = (name: string) => {
    const key = name.toLowerCase();
    if (key.includes("film") || key.includes("live")) return 0;
    if (key.includes("deco")) return 1;
    if (key.includes("3d")) return 2;
    return 3;
  };
  return [...names].sort((a, b) => rank(a) - rank(b));
};

export function StyleMosaic({ style, width, rowHeight, active, eager, children }: {
  style: StyleCardData; width: number; rowHeight: number; active?: boolean; eager?: boolean; children?: ReactNode;
}) {
  const cells = style.covers.slice(0, MOSAIC_COVERS);
  return (
    <span className="lm-mosaic" data-n={cells.length} data-on={active || undefined} style={{ width, height: rowHeight * 2 + 2 }}>
      {cells.length === 0 ? <span className="lm-mosaic-empty" /> : cells.map((frame, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={frame.assetId} {...tileAttrs(frame, cells.length === 1 || (cells.length === 3 && index === 0) ? width : Math.ceil(width / 2))}
          alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />
      ))}
      {children}
    </span>
  );
}

export function StyleCaption({ style, showMedium }: { style: StyleCardData; showMedium?: boolean }) {
  return (
    <>
      <span className="mt-2 block truncate text-[13px] font-extrabold uppercase leading-tight tracking-tight" style={display}>{style.name}</span>
      <span className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        {showMedium ? <span className="lm-medium-chip">{style.family}</span> : null}
        <span className="truncate">{framesLabel(style.frameCount)}</span>
      </span>
    </>
  );
}

// Colour under every picture before it lands; three frames read as one tall
// lead and two stacked, two as halves, one fills the card.
export const MOSAIC_CSS = `
.lm-mosaic{position:relative;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;overflow:hidden;border-radius:var(--lm-radius);background:var(--lm-surface-2);outline:2px solid transparent;outline-offset:2px;transition:outline-color .15s,box-shadow .15s}
.lm-mosaic img{width:100%;height:100%;object-fit:cover;display:block;min-width:0;min-height:0;background:var(--lm-surface-3);transition:transform .35s cubic-bezier(.2,.7,.2,1)}
.lm-mosaic[data-n="1"] img{grid-column:1/3;grid-row:1/3}
.lm-mosaic[data-n="2"] img{grid-row:1/3}
.lm-mosaic[data-n="3"] img:first-child{grid-row:1/3}
.lm-mosaic-empty{grid-column:1/3;grid-row:1/3}
a:hover .lm-mosaic,button:hover .lm-mosaic{outline-color:color-mix(in srgb,var(--lm-coral) 55%,transparent)}
a:hover .lm-mosaic img,button:hover .lm-mosaic img{transform:scale(1.02)}
.lm-mosaic[data-on]{outline-color:var(--lm-coral);box-shadow:0 0 0 6px rgba(255,122,100,.12),0 8px 30px -10px rgba(255,122,100,.55)}
.lm-medium-chip{font-weight:800;letter-spacing:.1em;padding:2px 5px;border-radius:var(--lm-radius);border:1px solid var(--lm-border-strong);color:var(--lm-text-secondary);line-height:1;white-space:nowrap}
`;
