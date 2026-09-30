/**
 * How many chips of a wrapping chip row fit in `maxRows` lines.
 *
 * Mirrors `flex-wrap` packing. When not every chip fits, the last line also
 * has to hold the "+N" overflow chip (`moreWidth`), so the answer leaves room
 * for it. A chip wider than the row is clamped to the row width (CSS truncates
 * it) and takes a line of its own.
 */
export function fitChipsInRows({
  widths,
  rowWidth,
  gap,
  maxRows,
  moreWidth,
}: {
  widths: number[];
  rowWidth: number;
  gap: number;
  maxRows: number;
  moreWidth: number;
}): number {
  if (rowWidth <= 0 || maxRows <= 0) return widths.length;
  if (countRows(widths, rowWidth, gap) <= maxRows) return widths.length;
  for (let visible = widths.length - 1; visible > 0; visible--) {
    const packed = [...widths.slice(0, visible), moreWidth];
    if (countRows(packed, rowWidth, gap) <= maxRows) return visible;
  }
  return 0;
}

function countRows(widths: number[], rowWidth: number, gap: number): number {
  let rows = 0;
  let x = 0;
  for (const raw of widths) {
    const width = Math.min(raw, rowWidth);
    if (rows === 0 || x + gap + width > rowWidth) {
      rows += 1;
      x = width;
    } else {
      x += gap + width;
    }
  }
  return rows;
}
