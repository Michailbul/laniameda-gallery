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

/**
 * Aspect below which a tile counts as "portrait" (3:4 and taller). 4:5 (0.8)
 * is only mildly vertical and reads fine at the normal row height, so it sits
 * just outside the band.
 */
export const PORTRAIT_ASPECT_THRESHOLD = 0.8;

/**
 * Aspect below which a tile counts as "tall portrait" (2:3 and taller — 9:16
 * reels live here at 0.5625). These get the stronger row boost.
 */
export const TALL_PORTRAIT_ASPECT_THRESHOLD = 0.7;

/**
 * Default row-height multiplier for rows containing a portrait. At a shared
 * row height a portrait tile is a narrow sliver (width = aspect × height);
 * boosting the whole row makes it grow in BOTH dimensions while the row still
 * justifies edge-to-edge with no holes.
 */
export const DEFAULT_PORTRAIT_ROW_BOOST = 1.7;

/**
 * Default row-height multiplier for rows containing a TALL portrait (9:16 and
 * friends) — these are format statements, not thumbnails, so they get roughly
 * double-row presence.
 */
export const DEFAULT_TALL_PORTRAIT_ROW_BOOST = 2.4;

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
   * 1.6 × targetRowHeight. Scaled by the portrait boost for portrait rows.
   */
  maxRowHeight?: number;
  /**
   * The final row is justified (stretched to fill the width) only when its
   * items, at target height, already span at least this fraction of the
   * container. Otherwise it is left-aligned at target height. Defaults to 0.7.
   */
  lastRowFillFraction?: number;
  /**
   * Row-height multiplier applied to rows containing a tile with aspect below
   * PORTRAIT_ASPECT_THRESHOLD, so portraits render at a usable size instead of
   * as slivers. Pass 1 to disable. Defaults to DEFAULT_PORTRAIT_ROW_BOOST.
   */
  portraitRowBoost?: number;
  /**
   * Stronger multiplier for rows containing a TALL portrait (aspect below
   * TALL_PORTRAIT_ASPECT_THRESHOLD — 9:16 reels). Pass 1 to disable. Defaults
   * to DEFAULT_TALL_PORTRAIT_ROW_BOOST.
   */
  tallPortraitRowBoost?: number;
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
  const maxRowHeightBase = options.maxRowHeight ?? targetRowHeight * 1.6;
  const lastRowFillFraction = options.lastRowFillFraction ?? 0.7;
  const portraitRowBoost = Math.max(
    1,
    options.portraitRowBoost ?? DEFAULT_PORTRAIT_ROW_BOOST,
  );
  const tallPortraitRowBoost = Math.max(
    portraitRowBoost,
    options.tallPortraitRowBoost ?? DEFAULT_TALL_PORTRAIT_ROW_BOOST,
  );

  if (
    containerWidth <= 0 ||
    targetRowHeight <= 0 ||
    inputs.length === 0
  ) {
    return { tiles: [], totalHeight: 0, rowCount: 0 };
  }

  const aspects = inputs.map((input) => clampAspect(resolveLayoutAspect(input)));
  const tiles: JustifiedTile[] = new Array(inputs.length);

  // Per-range helpers: rows holding a portrait target a taller height (see
  // portraitRowBoost / tallPortraitRowBoost) so the portrait isn't squeezed
  // into a sliver at the shared row height. The strongest member wins.
  const rangeAspectSum = (start: number, endExclusive: number) => {
    let sum = 0;
    for (let i = start; i < endExclusive; i += 1) sum += aspects[i]!;
    return sum;
  };
  const rangeBoost = (start: number, endExclusive: number) => {
    let boost = 1;
    for (let i = start; i < endExclusive; i += 1) {
      const aspect = aspects[i]!;
      if (aspect < TALL_PORTRAIT_ASPECT_THRESHOLD) return tallPortraitRowBoost;
      if (aspect < PORTRAIT_ASPECT_THRESHOLD) boost = portraitRowBoost;
    }
    return boost;
  };
  const rangeTarget = (start: number, endExclusive: number) =>
    targetRowHeight * rangeBoost(start, endExclusive);

  let top = 0;
  let rowIndex = 0;
  let rowStart = 0;

  const flushRow = (endExclusive: number, isLastRow: boolean) => {
    const count = endExclusive - rowStart;
    if (count <= 0) return;
    const gapsWidth = gap * (count - 1);
    const available = containerWidth - gapsWidth;
    const aspectSum = rangeAspectSum(rowStart, endExclusive);
    const boost = rangeBoost(rowStart, endExclusive);
    const rowTarget = targetRowHeight * boost;
    const rowMaxHeight = maxRowHeightBase * boost;

    // A row justifies (fills the full width) when it's an interior row, or the
    // final row is already nearly full. Otherwise the final row keeps target
    // height and left-aligns, leaving trailing space rather than blowing up.
    const naturalWidth = aspectSum * rowTarget + gapsWidth;
    const justify = !isLastRow || naturalWidth >= containerWidth * lastRowFillFraction;

    let height = justify ? available / aspectSum : rowTarget;
    height = Math.min(height, rowMaxHeight);
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
  };

  let i = 0;
  while (i < inputs.length) {
    const count = i - rowStart + 1;
    const gapsWidth = gap * (count - 1);
    const aspectSum = rangeAspectSum(rowStart, i + 1);
    const target = rangeTarget(rowStart, i + 1);
    const naturalWidth = aspectSum * target + gapsWidth;
    if (naturalWidth >= containerWidth) {
      // The row overflows once item i joins. Break either AFTER i (row is a
      // touch shorter than target) or BEFORE i (row is a touch taller) —
      // whichever justified height lands closer to that row's own target.
      // Without this, a boosted portrait row always crams to the overflow
      // side and loses most of its boost.
      if (count > 1) {
        const prevSum = rangeAspectSum(rowStart, i);
        const prevTarget = rangeTarget(rowStart, i);
        const prevMax = maxRowHeightBase * rangeBoost(rowStart, i);
        const prevGaps = gap * (count - 2);
        const heightBefore = (containerWidth - prevGaps) / prevSum;
        const heightAfter = (containerWidth - gapsWidth) / aspectSum;
        // Compare as RATIOS to each row's own target (a row 1.5× too tall is
        // as bad as one 1.5× too short) — a linear diff systematically prefers
        // the crammed side and erases the portrait boost.
        const breakBefore =
          heightBefore <= prevMax &&
          heightBefore / prevTarget <= target / heightAfter;
        if (breakBefore) {
          flushRow(i, false);
          continue; // re-evaluate item i as the start of the next row
        }
      }
      flushRow(i + 1, false);
    }
    i += 1;
  }
  if (rowStart < inputs.length) {
    flushRow(inputs.length, true);
  }

  const totalHeight = Math.max(0, top - gap);
  return { tiles, totalHeight, rowCount: rowIndex };
}
