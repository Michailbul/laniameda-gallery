/**
 * Pure layout math for the gallery grid.
 *
 * The gallery uses a JUSTIFIED ROWS layout (the "Flickr / Google Photos"
 * model): items flow left-to-right into rows, and every complete row is scaled
 * uniformly so it fills the container width exactly. Because every item in a
 * row shares the same height, each tile keeps its media's native aspect ratio —
 * there is no distortion and, crucially, no interior gaps or ragged column
 * bottoms. Only the final row may be partial. This replaced a column/skyline
 * packer that structurally left holes around wide (16:9+) cards.
 */

export const DEFAULT_GAP_PX = 12;

const VIDEO_FALLBACK_ASPECT = 16 / 9;
const IMAGE_FALLBACK_ASPECT = 1;
const SQUAREISH_VIDEO_TOLERANCE = 0.04;

/**
 * Clamp an aspect ratio (width / height) into a visually reasonable band so a
 * single outlier asset can't blow up the row rhythm. Below MIN_ASPECT the tile
 * would be very tall portrait (taller than ~2.2x its width); above MAX_ASPECT
 * it would be a thin landscape strip (wider than ~2.4x its height). The source
 * media keeps its true aspect on disk; only the layout slot is clamped.
 */
export const MIN_ASPECT = 0.45;
export const MAX_ASPECT = 2.4;

export function clampAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return IMAGE_FALLBACK_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect));
}

export type LayoutInput = {
  width?: number;
  height?: number;
  kind?: "image" | "video";
  contentType?: string;
};

const hasFiniteDims = (w?: number, h?: number): w is number =>
  typeof w === "number" &&
  typeof h === "number" &&
  Number.isFinite(w) &&
  Number.isFinite(h) &&
  w > 0 &&
  h > 0;

export function resolveLayoutKind(
  input: Pick<LayoutInput, "kind" | "contentType">,
): LayoutInput["kind"] {
  const contentType = input.contentType?.toLowerCase();
  if (input.kind === "video" || contentType?.startsWith("video/")) {
    return "video";
  }
  if (input.kind === "image" || contentType?.startsWith("image/")) {
    return "image";
  }
  return undefined;
}

export function resolveAspect(input: LayoutInput): number {
  if (hasFiniteDims(input.width, input.height)) {
    return clampAspect(input.width! / input.height!);
  }
  return resolveLayoutKind(input) === "video"
    ? VIDEO_FALLBACK_ASPECT
    : IMAGE_FALLBACK_ASPECT;
}

function shouldUseLandscapeVideoFallback(input: LayoutInput): boolean {
  if (
    resolveLayoutKind(input) !== "video" ||
    !hasFiniteDims(input.width, input.height)
  ) {
    return false;
  }
  return Math.abs(input.width! / input.height! - 1) < SQUAREISH_VIDEO_TOLERANCE;
}

export function resolveLayoutAspect(input: LayoutInput): number {
  return shouldUseLandscapeVideoFallback(input)
    ? VIDEO_FALLBACK_ASPECT
    : resolveAspect(input);
}

/* ── Justified rows layout ── */

export type JustifiedOptions = {
  /** Content-box width available to the grid, in px (no padding). */
  containerWidth: number;
  /** Gap between tiles, both horizontal and vertical, in px. */
  gap: number;
  /**
   * Desired row height in px. A row is closed as soon as the accumulated items
   * would, at this height, meet or exceed the container width — so complete
   * rows always end up at or slightly below this height.
   */
  targetRowHeight: number;
  /**
   * Ceiling for a justified row's height. Guards the sparse cases (a lone
   * ultra-wide item, or a short final row) from ballooning. Defaults to
   * 1.6 × targetRowHeight.
   */
  maxRowHeight?: number;
  /**
   * The final row is justified (stretched to fill the width) only when its
   * items, at target height, already span at least this fraction of the
   * container. Otherwise it is left-aligned at target height. Defaults to 0.7.
   */
  lastRowFillFraction?: number;
};

export type JustifiedTile = {
  /** Index into the input array this tile corresponds to. */
  index: number;
  /** Row number (0-based) this tile landed in. */
  row: number;
  top: number;
  left: number;
  width: number;
  height: number;
};

export type JustifiedLayout = {
  /** Tiles in input order (tiles[i] is the layout for inputs[i]). */
  tiles: JustifiedTile[];
  /** Total content height in px (bottom of the last row, no trailing gap). */
  totalHeight: number;
  rowCount: number;
};

/**
 * Lay out items as justified rows. Every complete row fills `containerWidth`
 * exactly; each tile keeps its (clamped) native aspect ratio. The last row is
 * justified only if it is nearly full, otherwise it keeps target height and
 * left-aligns (a single blown-up image would look worse than trailing space).
 */
export function layoutJustified(
  inputs: LayoutInput[],
  options: JustifiedOptions,
): JustifiedLayout {
  const { containerWidth, gap, targetRowHeight } = options;
  const maxRowHeight = options.maxRowHeight ?? targetRowHeight * 1.6;
  const lastRowFillFraction = options.lastRowFillFraction ?? 0.7;

  if (
    containerWidth <= 0 ||
    targetRowHeight <= 0 ||
    inputs.length === 0
  ) {
    return { tiles: [], totalHeight: 0, rowCount: 0 };
  }

  const aspects = inputs.map((input) => clampAspect(resolveLayoutAspect(input)));
  const tiles: JustifiedTile[] = new Array(inputs.length);

  let top = 0;
  let rowIndex = 0;
  let rowStart = 0;
  let aspectSum = 0;

  const flushRow = (endExclusive: number, isLastRow: boolean) => {
    const count = endExclusive - rowStart;
    if (count <= 0) return;
    const gapsWidth = gap * (count - 1);
    const available = containerWidth - gapsWidth;

    // A row justifies (fills the full width) when it's an interior row, or the
    // final row is already nearly full. Otherwise the final row keeps target
    // height and left-aligns, leaving trailing space rather than blowing up.
    const naturalWidth = aspectSum * targetRowHeight + gapsWidth;
    const justify = !isLastRow || naturalWidth >= containerWidth * lastRowFillFraction;

    let height = justify ? available / aspectSum : targetRowHeight;
    height = Math.min(height, maxRowHeight);
    height = Math.max(1, Math.round(height));

    let left = 0;
    for (let i = rowStart; i < endExclusive; i += 1) {
      const isLastInRow = i === endExclusive - 1;
      // Snap the final tile of a justified row to the container edge so integer
      // rounding never leaves a hairline gap; media is object-cover/contain so
      // the sub-pixel aspect nudge is invisible.
      const width =
        justify && isLastInRow
          ? Math.max(1, containerWidth - left)
          : Math.max(1, Math.round(height * aspects[i]!));
      tiles[i] = { index: i, row: rowIndex, top, left, width, height };
      left += width + gap;
    }

    top += height + gap;
    rowIndex += 1;
    rowStart = endExclusive;
    aspectSum = 0;
  };

  for (let i = 0; i < inputs.length; i += 1) {
    aspectSum += aspects[i]!;
    const count = i - rowStart + 1;
    const gapsWidth = gap * (count - 1);
    const naturalWidth = aspectSum * targetRowHeight + gapsWidth;
    if (naturalWidth >= containerWidth) {
      flushRow(i + 1, false);
    }
  }
  if (rowStart < inputs.length) {
    flushRow(inputs.length, true);
  }

  const totalHeight = Math.max(0, top - gap);
  return { tiles, totalHeight, rowCount: rowIndex };
}
