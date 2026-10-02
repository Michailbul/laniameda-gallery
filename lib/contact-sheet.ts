// The agent contact sheet contract: many gallery pieces composed into one
// numbered grid image, so an agent can look at a whole result page in a single
// vision read and pick by number instead of guessing from URLs and captions.
//
// Pure layout + label drawing, shared by the Convex composer
// (convex/agentPreview.ts) and its tests. Labels are drawn as SVG rects from a
// built-in bitmap font, never as <text>, so the sheet renders the same on a
// runtime that ships no system fonts.

/** Claude scales any image down to fit a ~1568px long edge, so a sheet larger
 *  than this only costs bytes. */
export const CONTACT_SHEET_DEFAULT_MAX_EDGE = 1568;
export const CONTACT_SHEET_MIN_MAX_EDGE = 512;
export const CONTACT_SHEET_MAX_MAX_EDGE = 2400;
/** Past ~48 cells a cell drops under ~190px and pieces stop being legible. */
export const CONTACT_SHEET_MAX_CELLS = 48;
export const CONTACT_SHEET_DEFAULT_CELLS = 24;
export const CONTACT_SHEET_MAX_COLUMNS = 12;
export const CONTACT_SHEET_GAP = 6;
export const CONTACT_SHEET_BACKGROUND = { r: 18, g: 18, b: 20 };
export const CONTACT_SHEET_CELL_BACKGROUND = { r: 34, g: 34, b: 38 };
export const CONTACT_SHEET_JPEG_QUALITY = 82;

export type ContactSheetLayout = {
  count: number;
  columns: number;
  rows: number;
  cellSize: number;
  gap: number;
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A roughly 4:3 grid: 4 → 2×2, 6 → 3×2, 24 → 6×4, 48 → 8×6. */
export const autoContactSheetColumns = (count: number) => {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return Math.ceil(Math.sqrt((count * 4) / 3));
};

export const layoutContactSheet = (
  count: number,
  options: { columns?: number; maxEdge?: number } = {},
): ContactSheetLayout => {
  const safeCount = Math.max(1, Math.floor(count));
  const maxEdge = clamp(
    Math.floor(options.maxEdge ?? CONTACT_SHEET_DEFAULT_MAX_EDGE),
    CONTACT_SHEET_MIN_MAX_EDGE,
    CONTACT_SHEET_MAX_MAX_EDGE,
  );
  const columns = clamp(
    Math.floor(options.columns ?? autoContactSheetColumns(safeCount)),
    1,
    Math.min(CONTACT_SHEET_MAX_COLUMNS, safeCount),
  );
  const rows = Math.ceil(safeCount / columns);
  const gap = CONTACT_SHEET_GAP;
  // Square cells, sized so neither edge of the sheet passes maxEdge.
  const byWidth = Math.floor((maxEdge - gap * (columns + 1)) / columns);
  const byHeight = Math.floor((maxEdge - gap * (rows + 1)) / rows);
  const cellSize = Math.max(32, Math.min(byWidth, byHeight));
  return {
    count: safeCount,
    columns,
    rows,
    cellSize,
    gap,
    width: columns * cellSize + gap * (columns + 1),
    height: rows * cellSize + gap * (rows + 1),
  };
};

/** Top-left corner of cell `index` (0-based, row-major). */
export const contactSheetCellOrigin = (layout: ContactSheetLayout, index: number) => {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    left: layout.gap + column * (layout.cellSize + layout.gap),
    top: layout.gap + row * (layout.cellSize + layout.gap),
  };
};

// 5×7 bitmap digits, one string per row, "#" = lit.
const DIGIT_GLYPHS: Record<string, string[]> = {
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
};
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/** Pixel size of one bitmap-font dot for a cell this big. */
export const contactSheetLabelScale = (cellSize: number) =>
  clamp(Math.round(cellSize / 64), 2, 6);

/** SVG rects (no wrapper) spelling `digits` with its top-left at (x, y). */
export const bitmapDigitsSvg = (digits: string, x: number, y: number, scale: number) => {
  const rects: string[] = [];
  [...digits].forEach((char, charIndex) => {
    const glyph = DIGIT_GLYPHS[char];
    if (!glyph) return;
    const originX = x + charIndex * (GLYPH_WIDTH + 1) * scale;
    glyph.forEach((row, rowIndex) => {
      // Merge horizontal runs so a label is a handful of rects, not dozens.
      let runStart = -1;
      for (let column = 0; column <= GLYPH_WIDTH; column += 1) {
        const lit = row[column] === "#";
        if (lit && runStart < 0) runStart = column;
        if (!lit && runStart >= 0) {
          rects.push(
            `<rect x="${originX + runStart * scale}" y="${y + rowIndex * scale}" width="${(column - runStart) * scale}" height="${scale}"/>`,
          );
          runStart = -1;
        }
      }
    });
  });
  return rects.join("");
};

export const bitmapDigitsWidth = (digits: string, scale: number) =>
  digits.length === 0 ? 0 : (digits.length * (GLYPH_WIDTH + 1) - 1) * scale;

export type ContactSheetCellBadges = {
  /** 1-based number printed on the cell. */
  number: number;
  isVideo?: boolean;
  /** No pixels could be drawn: crosses the cell out. */
  failed?: boolean;
};

/** One cell-sized SVG overlay: the number badge top-left, a play badge
 *  top-right for videos, a cross for a cell with nothing to show. */
export const contactSheetCellOverlaySvg = (
  cellSize: number,
  badges: ContactSheetCellBadges,
) => {
  const scale = contactSheetLabelScale(cellSize);
  const digits = String(badges.number);
  const padding = scale * 2;
  const badgeWidth = bitmapDigitsWidth(digits, scale) + padding * 2;
  const badgeHeight = GLYPH_HEIGHT * scale + padding * 2;
  const parts: string[] = [];

  if (badges.failed) {
    const inset = Math.round(cellSize * 0.3);
    const far = cellSize - inset;
    const stroke = Math.max(2, scale);
    parts.push(
      `<g stroke="#6b6b73" stroke-width="${stroke}" stroke-linecap="round">` +
        `<line x1="${inset}" y1="${inset}" x2="${far}" y2="${far}"/>` +
        `<line x1="${far}" y1="${inset}" x2="${inset}" y2="${far}"/></g>`,
    );
  }

  parts.push(
    `<rect x="0" y="0" width="${badgeWidth}" height="${badgeHeight}" rx="${scale}" fill="#000" fill-opacity="0.78"/>`,
    `<g fill="#fff">${bitmapDigitsSvg(digits, padding, padding, scale)}</g>`,
  );

  if (badges.isVideo) {
    const size = badgeHeight;
    const left = cellSize - size;
    const inset = Math.round(size * 0.28);
    parts.push(
      `<rect x="${left}" y="0" width="${size}" height="${size}" rx="${scale}" fill="#000" fill-opacity="0.78"/>`,
      `<polygon fill="#fff" points="${left + inset},${inset} ${left + size - inset},${size / 2} ${left + inset},${size - inset}"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cellSize}" height="${cellSize}" viewBox="0 0 ${cellSize} ${cellSize}">${parts.join("")}</svg>`;
};
