/**
 * Pure layout math for the gallery masonry grid.
 *
 * The masonry uses CSS `grid` with a tiny `grid-auto-rows` unit (ROW_UNIT_PX)
 * so each card can occupy a precise number of "row units" matching its
 * rendered pixel height. Images span a single column; videos prefer two
 * columns when the viewport has room, with height still computed from the
 * video's native visual aspect ratio. Placement is computed explicitly so the
 * browser does not strand empty shelves.
 */

export const ROW_UNIT_PX = 1;
export const DEFAULT_GAP_PX = 12;

const VIDEO_FALLBACK_ASPECT = 16 / 9;
const IMAGE_FALLBACK_ASPECT = 1;
const SQUAREISH_VIDEO_TOLERANCE = 0.04;

export const VIDEO_CARD_COLUMN_SPAN = 2;

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
  return computeCellLayoutForSpan(
    input,
    geometry,
    resolveColumnSpan(input, geometry),
  );
}

function computeCellLayoutForSpan(
  input: LayoutInput,
  geometry: ColumnGeometry,
  requestedColSpan: number,
): CellLayout {
  const colW = columnWidth(geometry);
  if (colW <= 0) {
    return { colSpan: 1, rowSpan: 1 };
  }
  const colSpan = Math.max(
    1,
    Math.min(Math.floor(requestedColSpan), geometry.columnCount),
  );
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
 * Deterministic dense placement for the masonry grid. Items keep their
 * preferred width when it does not open a vertical hole; wide media can fall
 * back to a single column to fill shorter lanes first.
 */
export type PackedItem = {
  index: number;
  column: number;
  colSpan: number;
  startRow: number;
  rowSpan: number;
};

export function packMasonry(
  items: LayoutInput[],
  geometry: ColumnGeometry,
): { totalRows: number; placements: PackedItem[]; gapRows: number } {
  const { columnCount } = geometry;
  if (columnCount <= 0 || items.length === 0) {
    return { totalRows: 0, placements: [], gapRows: 0 };
  }
  const columnHeights = new Array<number>(columnCount).fill(0);
  const placements: PackedItem[] = [];
  let totalRows = 0;
  let usedRows = 0;

  const candidatesForLayout = (layout: CellLayout, candidateIndex: number) => {
    const candidates: Array<{
      layout: CellLayout;
      candidateIndex: number;
      column: number;
      startRow: number;
      wasteRows: number;
    }> = [];

    for (let column = 0; column <= columnCount - layout.colSpan; column += 1) {
      const coveredHeights = columnHeights.slice(
        column,
        column + layout.colSpan,
      );
      const startAfterRow = Math.max(...coveredHeights);
      candidates.push({
        layout,
        candidateIndex,
        column,
        startRow: startAfterRow + 1,
        wasteRows: coveredHeights.reduce(
          (sum, height) => sum + startAfterRow - height,
          0,
        ),
      });
    }

    return candidates;
  };

  const choosePlacement = (item: LayoutInput) => {
    const preferred = computeCellLayout(item, geometry);
    const candidates =
      preferred.colSpan > 1
        ? [preferred, computeCellLayoutForSpan(item, geometry, 1)]
        : [preferred];

    return candidates
      .flatMap((layout, candidateIndex) =>
        candidatesForLayout(layout, candidateIndex),
      )
      .sort((left, right) => {
        if (left.wasteRows !== right.wasteRows) {
          return left.wasteRows - right.wasteRows;
        }
        if (left.startRow !== right.startRow) {
          return left.startRow - right.startRow;
        }
        if (left.candidateIndex !== right.candidateIndex) {
          return left.candidateIndex - right.candidateIndex;
        }
        return left.column - right.column;
      })[0]!;
  };

  items.forEach((item, index) => {
    const {
      layout: { colSpan, rowSpan },
      column,
      startRow,
    } = choosePlacement(item);
    const endRow = startRow + rowSpan - 1;

    for (let col = column; col < column + colSpan; col += 1) {
      columnHeights[col] = endRow;
    }
    placements.push({
      index,
      column,
      colSpan,
      startRow,
      rowSpan,
    });
    usedRows += colSpan * rowSpan;
    totalRows = Math.max(totalRows, endRow);
  });

  const reservedRows = totalRows * columnCount;
  const gapRows = Math.max(0, reservedRows - usedRows);

  return { totalRows, placements, gapRows };
}
