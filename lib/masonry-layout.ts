/**
 * Pure layout math for the gallery masonry grid.
 *
 * The masonry uses CSS `grid` with a tiny `grid-auto-rows` unit (ROW_UNIT_PX)
 * so each card can occupy a precise number of "row units" matching its
 * rendered pixel height. Portrait/squarish images span a single column;
 * videos and wide (≥16:9) images span two columns when the viewport has room,
 * with height still computed from the media's native aspect ratio. Placement
 * is computed explicitly so the browser does not strand empty shelves.
 */

export const ROW_UNIT_PX = 1;
export const DEFAULT_GAP_PX = 12;

const VIDEO_FALLBACK_ASPECT = 16 / 9;
const IMAGE_FALLBACK_ASPECT = 1;
const SQUAREISH_VIDEO_TOLERANCE = 0.04;

export const VIDEO_CARD_COLUMN_SPAN = 2;

// Wide landscape images (16:9 and wider) render as thin, small strips in a
// single column. Let them span two columns — same footprint trick as videos —
// so they read as a large banner while keeping their native aspect ratio.
// 1.7 catches 16:9 (≈1.78) and everything wider; 3:2 (1.5) and 16:10 (1.6)
// stay single-column.
export const WIDE_CARD_COLUMN_SPAN = 2;
export const WIDE_IMAGE_ASPECT_THRESHOLD = 1.7;

/**
 * Clamp an aspect ratio (width / height) into a visually reasonable band so a
 * single outlier asset can't blow up the masonry rhythm. Below MIN_ASPECT the
 * card would be very tall portrait (taller than ~2.2x its width); above
 * MAX_ASPECT it would be a thin landscape strip (wider than ~2.4x its height).
 * The source media keeps its true aspect on disk; only the masonry slot is
 * clamped into a manageable display footprint.
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

export type CellLayout = {
  colSpan: number;
  rowSpan: number;
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

export function isWideImage(input: LayoutInput): boolean {
  return (
    resolveLayoutKind(input) === "image" &&
    hasFiniteDims(input.width, input.height) &&
    input.width! / input.height! >= WIDE_IMAGE_ASPECT_THRESHOLD
  );
}

export function resolveColumnSpan(
  input: LayoutInput,
  geometry: ColumnGeometry,
): number {
  if (
    resolveLayoutKind(input) === "video" &&
    geometry.columnCount >= VIDEO_CARD_COLUMN_SPAN
  ) {
    return VIDEO_CARD_COLUMN_SPAN;
  }
  if (isWideImage(input) && geometry.columnCount >= WIDE_CARD_COLUMN_SPAN) {
    return WIDE_CARD_COLUMN_SPAN;
  }
  return 1;
}

export type ColumnGeometry = {
  contentWidth: number;
  columnCount: number;
  gap: number;
};

/**
 * Compute the pixel width of a single column given the full content area.
 */
export function columnWidth(geometry: ColumnGeometry): number {
  const { contentWidth, columnCount, gap } = geometry;
  if (columnCount <= 0) return 0;
  return (contentWidth - gap * (columnCount - 1)) / columnCount;
}

/**
 * Compute the grid `rowSpan` needed to host a card of the given pixel height,
 * with the configured `ROW_UNIT_PX` row size and inter-row gap.
 *
 * Total occupied vertical pixels with N row spans is:
 *   N * ROW_UNIT_PX + (N - 1) * gap
 * We solve for the smallest N such that that height >= cardH.
 */
export function rowSpanForHeight(cardH: number, gap: number): number {
  if (!Number.isFinite(cardH) || cardH <= 0) return 1;
  return Math.max(1, Math.ceil((cardH + gap) / (ROW_UNIT_PX + gap)));
}

/**
 * Cell layout for an item in masonry. Images stay single-column. Videos span
 * two columns when available, but retain their native aspect ratio; only their
 * masonry footprint gets larger.
 */
export function computeCellLayout(
  input: LayoutInput,
  geometry: ColumnGeometry,
): CellLayout {
  const colW = columnWidth(geometry);
  if (colW <= 0) {
    return { colSpan: 1, rowSpan: 1 };
  }
  const colSpan = resolveColumnSpan(input, geometry);
  const aspect = resolveLayoutAspect(input);
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return { colSpan: 1, rowSpan: 1 };
  }
  const cardW = colW * colSpan + geometry.gap * Math.max(0, colSpan - 1);
  const cardH = cardW / aspect;
  return {
    colSpan,
    rowSpan: rowSpanForHeight(cardH, geometry.gap),
  };
}

/**
 * Simulate the visual height of a single card after layout — useful in tests
 * to verify that the rowSpan we picked actually accommodates the card.
 */
export function reservedHeightForCell(
  layout: CellLayout,
  gap: number,
): number {
  if (layout.rowSpan <= 0) return 0;
  return (
    layout.rowSpan * ROW_UNIT_PX + Math.max(0, layout.rowSpan - 1) * gap
  );
}

/**
 * Deterministic gap-free placement for the masonry grid.
 *
 * Single-column cards stack onto the shortest column (classic masonry). A
 * multi-column card needs adjacent columns at the same height, so the packer
 * (a) picks the window of columns that buries the smallest hole, (b) pulls
 * upcoming single-column cards forward to level the columns first, and
 * (c) stretches the card above any small residual hole so the wide card sits
 * flush (`object-cover` absorbs the crop). Cards may therefore render out of
 * array order — consumers should mount them sorted by `startRow`.
 */
export type PackedItem = {
  index: number;
  column: number;
  colSpan: number;
  startRow: number;
  rowSpan: number;
};

// How many upcoming cards the packer may pull forward to level columns under
// a wide card, and how much of a card's own height it may stretch to close a
// residual hole. Holes up to HOLE_TOLERANCE_ROWS are treated as free when
// choosing a window — they're small enough for the stretch pass to absorb.
export const PACK_PULL_LOOKAHEAD = 16;
export const MAX_STRETCH_FRACTION = 0.15;
export const HOLE_TOLERANCE_ROWS = 2;
// Final adaptive pass: a residual hole is distributed across the contiguous
// run of single-column image cards directly above it, each stretching at most
// this fraction of its own height (media renders object-cover, so the crop is
// modest and spread out). Wide cards are never shrunk.
export const MAX_ADAPTIVE_STRETCH_FRACTION = 0.5;

type PackWindow = { column: number; startRow: number; holeRows: number };

export function packMasonry(
  items: LayoutInput[],
  geometry: ColumnGeometry,
): { totalRows: number; placements: PackedItem[]; gapRows: number } {
  const { columnCount } = geometry;
  if (columnCount <= 0 || items.length === 0) {
    return { totalRows: 0, placements: [], gapRows: 0 };
  }

  const layouts = items.map((item) => computeCellLayout(item, geometry));
  // Next free row per column (CSS grid rows are 1-based).
  const bottoms: number[] = new Array(columnCount).fill(1);
  const lastInColumn: (PackedItem | null)[] = new Array(columnCount).fill(
    null,
  );
  const placements: PackedItem[] = new Array(items.length);
  const queue: number[] = items.map((_, index) => index);

  const record = (placement: PackedItem) => {
    placements[placement.index] = placement;
    const end = placement.column + placement.colSpan;
    for (let col = placement.column; col < end; col += 1) {
      bottoms[col] = placement.startRow + placement.rowSpan;
      lastInColumn[col] = placement;
    }
  };

  const shortestColumn = (): number => {
    let pick = 0;
    for (let col = 1; col < columnCount; col += 1) {
      if (bottoms[col] < bottoms[pick]) pick = col;
    }
    return pick;
  };

  const placeSingle = (index: number) => {
    const col = shortestColumn();
    record({
      index,
      column: col,
      colSpan: 1,
      startRow: bottoms[col],
      rowSpan: layouts[index].rowSpan,
    });
  };

  const effectiveHole = (holeRows: number) =>
    holeRows <= HOLE_TOLERANCE_ROWS ? 0 : holeRows;

  const bestWindow = (colSpan: number, floor: number[]): PackWindow => {
    let best: PackWindow | null = null;
    for (let col = 0; col + colSpan <= columnCount; col += 1) {
      let startRow = 1;
      for (let k = col; k < col + colSpan; k += 1) {
        startRow = Math.max(startRow, floor[k]);
      }
      let holeRows = 0;
      for (let k = col; k < col + colSpan; k += 1) {
        holeRows += startRow - floor[k];
      }
      if (
        !best ||
        effectiveHole(holeRows) < effectiveHole(best.holeRows) ||
        (effectiveHole(holeRows) === effectiveHole(best.holeRows) &&
          startRow < best.startRow)
      ) {
        best = { column: col, startRow, holeRows };
      }
    }
    return best!;
  };

  // Stretch the single-column image card at the bottom of `col` so the column
  // reaches `targetRow`. Skipped when the hole is too tall relative to the
  // card (the crop would be visible) or the card is a video/multi-column.
  const absorbHoleBelow = (col: number, targetRow: number) => {
    const above = lastInColumn[col];
    if (!above || above.colSpan !== 1) return;
    if (resolveLayoutKind(items[above.index]) !== "image") return;
    const hole = targetRow - bottoms[col];
    if (hole <= 0) return;
    if (hole > Math.floor(above.rowSpan * MAX_STRETCH_FRACTION)) return;
    above.rowSpan += hole;
    bottoms[col] = targetRow;
  };

  while (queue.length > 0) {
    const index = queue.shift()!;
    const { colSpan, rowSpan } = layouts[index];
    if (colSpan <= 1) {
      placeSingle(index);
      continue;
    }

    // Level the columns before burying a hole under the wide card: pull
    // upcoming single-column cards forward while doing so strictly shrinks
    // the hole the wide card would leave behind.
    let best = bestWindow(colSpan, bottoms);
    while (effectiveHole(best.holeRows) > 0) {
      let pullPos = -1;
      const horizon = Math.min(queue.length, PACK_PULL_LOOKAHEAD);
      for (let pos = 0; pos < horizon; pos += 1) {
        if (layouts[queue[pos]].colSpan === 1) {
          pullPos = pos;
          break;
        }
      }
      if (pullPos === -1) break;
      const pulledIndex = queue[pullPos];
      const col = shortestColumn();
      const simulated = bottoms.slice();
      simulated[col] += layouts[pulledIndex].rowSpan;
      const simulatedBest = bestWindow(colSpan, simulated);
      if (
        effectiveHole(simulatedBest.holeRows) >= effectiveHole(best.holeRows)
      ) {
        break;
      }
      queue.splice(pullPos, 1);
      placeSingle(pulledIndex);
      best = simulatedBest;
    }

    for (let col = best.column; col < best.column + colSpan; col += 1) {
      absorbHoleBelow(col, best.startRow);
    }

    record({
      index,
      column: best.column,
      colSpan,
      startRow: best.startRow,
      rowSpan,
    });
  }

  closeResidualHoles(items, placements, columnCount);

  let totalRows = 0;
  let usedCells = 0;
  for (const placement of placements) {
    totalRows = Math.max(totalRows, placement.startRow + placement.rowSpan - 1);
    usedCells += placement.colSpan * placement.rowSpan;
  }
  const gapRows = Math.max(0, totalRows * columnCount - usedCells);

  return { totalRows, placements, gapRows };
}

// Adaptive gap absorption: for every interior hole left after packing (a gap
// between two consecutive cards in a column, which only happens beneath the
// shorter side of a multi-column card), stretch the contiguous run of
// single-column image cards directly above it so their combined extra height
// fills the hole. Single-column cards can shift/stretch freely without
// touching other columns; videos (object-contain would letterbox) and
// multi-column cards are left alone.
function closeResidualHoles(
  items: LayoutInput[],
  placements: PackedItem[],
  columnCount: number,
): void {
  for (let col = 0; col < columnCount; col += 1) {
    const stack = placements
      .filter(
        (placement) =>
          placement.column <= col && col < placement.column + placement.colSpan,
      )
      .sort((a, b) => a.startRow - b.startRow);

    for (let i = 1; i < stack.length; i += 1) {
      const prev = stack[i - 1]!;
      const next = stack[i]!;
      const gap = next.startRow - (prev.startRow + prev.rowSpan);
      if (gap <= 0) continue;

      // Contiguous run of absorbable cards ending at `prev`, walking upward.
      const run: PackedItem[] = [];
      for (let j = i - 1; j >= 0; j -= 1) {
        const candidate = stack[j]!;
        if (candidate.colSpan !== 1) break;
        if (resolveLayoutKind(items[candidate.index] ?? {}) !== "image") break;
        run.unshift(candidate);
        const above = stack[j - 1];
        if (above && above.startRow + above.rowSpan !== candidate.startRow) {
          break;
        }
      }
      if (run.length === 0) continue;

      const capacity = run.map((placement) =>
        Math.floor(placement.rowSpan * MAX_ADAPTIVE_STRETCH_FRACTION),
      );
      let remaining = Math.min(
        gap,
        capacity.reduce((sum, value) => sum + value, 0),
      );
      let shift = 0;
      for (let j = 0; j < run.length; j += 1) {
        const placement = run[j]!;
        placement.startRow += shift;
        const fairShare = Math.ceil(remaining / (run.length - j));
        const add = Math.min(fairShare, capacity[j]!, remaining);
        placement.rowSpan += add;
        shift += add;
        remaining -= add;
      }
    }
  }
}
