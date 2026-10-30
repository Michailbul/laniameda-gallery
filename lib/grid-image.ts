// What a grid tile's <img> asks the browser for. R2 holds up to four
// renditions of an image: the grid variants (480 and 960 wide, WebP), the card
// thumb (WebP, fit inside 1440×960, lib/card-thumbnail.ts) and the original.
// All go in `srcset` with their real widths, and `sizes` says how wide the
// tile is, so the browser takes the smallest rendition that covers the tile
// at its pixel density and the original only when nothing else does. The
// detail panel keeps the original: this is only for tiles.

export type GridImageSource = {
  /** The card rendition (thumb when it is sharp enough, else the original). */
  src: string;
  /** Grid renditions below the thumb (480, 960 wide), when stored. */
  variants?: ReadonlyArray<{ url: string; width: number }>;
  /** The thumb, when one exists and differs from the original. */
  thumbSrc?: string;
  thumbWidth?: number;
  /** The original file and its pixel width. */
  fullSrc?: string;
  fullWidth?: number;
};

export type GridImageAttrs = {
  src: string;
  srcSet?: string;
  sizes: string;
};

/** The default `sizes`, from the grid's column counts per breakpoint. */
export const GRID_IMAGE_SIZES =
  "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw";
export const GRID_VIDEO_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 66vw, (max-width: 1280px) 50vw, 40vw";

const usableWidth = (width: number | undefined): width is number =>
  typeof width === "number" && Number.isFinite(width) && width > 0;

/** `sizes` for one tile: its laid-out width when the grid knows it (the
 *  justified layout does), else the breakpoint estimate. */
export const gridImageSizes = (
  tileWidth: number | undefined,
  kind: "image" | "video" | undefined = "image",
): string =>
  usableWidth(tileWidth)
    ? `${Math.round(tileWidth)}px`
    : kind === "video"
      ? GRID_VIDEO_SIZES
      : GRID_IMAGE_SIZES;

/**
 * `src`, `srcSet` and `sizes` for a tile. The srcset lists each distinct
 * rendition once with its real width; a rendition without a known width is
 * left out of the srcset (a lie about width makes the browser pick wrong), and
 * when fewer than two renditions qualify there is no srcset at all.
 */
export const buildGridImageAttrs = (
  source: GridImageSource,
  tileWidth?: number,
  kind: "image" | "video" | undefined = "image",
): GridImageAttrs => {
  const sizes = gridImageSizes(tileWidth, kind);
  const candidates: Array<{ url: string; width: number }> = [];
  const push = (url: string | undefined, width: number | undefined) => {
    if (!url || !usableWidth(width)) return;
    if (candidates.some((candidate) => candidate.url === url)) return;
    candidates.push({ url, width: Math.round(width) });
  };
  for (const variant of source.variants ?? []) push(variant.url, variant.width);
  push(source.thumbSrc, source.thumbWidth);
  push(source.fullSrc, source.fullWidth);
  if (candidates.length < 2) {
    return { src: source.src, sizes };
  }
  candidates.sort((left, right) => left.width - right.width);
  return {
    src: source.src,
    srcSet: candidates.map((candidate) => `${candidate.url} ${candidate.width}w`).join(", "),
    sizes,
  };
};
