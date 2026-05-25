import { describe, expect, test } from "bun:test";

import {
  clampAspect,
  columnWidth,
  computeCellLayout,
  MAX_ASPECT,
  MIN_ASPECT,
  packMasonry,
  reservedHeightForCell,
  resolveAspect,
  resolveColumnSpan,
  resolveLayoutAspect,
  rowSpanForHeight,
  ROW_UNIT_PX,
  VIDEO_CARD_COLUMN_SPAN,
  type ColumnGeometry,
  type LayoutInput,
} from "../lib/masonry-layout";

const geometry4col1200 = (): ColumnGeometry => ({
  contentWidth: 1200,
  columnCount: 4,
  gap: 14,
});

describe("resolveAspect", () => {
  test("uses real dimensions when present, clamped to a sensible band", () => {
    expect(resolveAspect({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9, 4);
    // 9:16 portrait (0.5625) is inside the band — used as-is.
    expect(resolveAspect({ width: 1080, height: 1920 })).toBeCloseTo(9 / 16, 4);
    expect(resolveAspect({ width: 1024, height: 1024 })).toBe(1);
  });

  test("clamps extreme aspect ratios so a single outlier asset can't break the rhythm", () => {
    // Very-wide banner (e.g. 3000x300, aspect 10) → clamped to MAX_ASPECT.
    expect(resolveAspect({ width: 3000, height: 300 })).toBe(MAX_ASPECT);
    // Very-tall column (e.g. 200x2000, aspect 0.1) → clamped to MIN_ASPECT.
    expect(resolveAspect({ width: 200, height: 2000 })).toBe(MIN_ASPECT);
  });

  test("falls back to 16:9 for videos without dimensions", () => {
    expect(resolveAspect({ kind: "video" })).toBeCloseTo(16 / 9, 4);
    expect(resolveAspect({ kind: "video", width: 0, height: 0 })).toBeCloseTo(
      16 / 9,
      4,
    );
  });

  test("falls back to square for images without dimensions", () => {
    expect(resolveAspect({ kind: "image" })).toBe(1);
    expect(resolveAspect({})).toBe(1);
  });
});

describe("resolveLayoutAspect", () => {
  test("preserves native video aspect instead of stretching the slot", () => {
    expect(
      resolveLayoutAspect({ width: 1920, height: 1080, kind: "video" }),
    ).toBeCloseTo(16 / 9, 4);
    expect(
      resolveLayoutAspect({ width: 1920, height: 1080, kind: "image" }),
    ).toBeCloseTo(16 / 9, 4);
  });

  test("uses landscape video layout for square poster dimensions", () => {
    expect(
      resolveLayoutAspect({ width: 1024, height: 1024, kind: "video" }),
    ).toBeCloseTo(16 / 9, 4);
  });
});

describe("resolveColumnSpan", () => {
  test("makes videos wider when there is enough masonry space", () => {
    expect(
      resolveColumnSpan(
        { width: 1920, height: 1080, kind: "video" },
        geometry4col1200(),
      ),
    ).toBe(VIDEO_CARD_COLUMN_SPAN);
    expect(
      resolveColumnSpan(
        { width: 1920, height: 1080, kind: "image" },
        geometry4col1200(),
      ),
    ).toBe(1);
  });

  test("keeps videos single-column on one-column layouts", () => {
    expect(
      resolveColumnSpan(
        { width: 1920, height: 1080, kind: "video" },
        { contentWidth: 320, columnCount: 1, gap: 12 },
      ),
    ).toBe(1);
  });
});

describe("clampAspect", () => {
  test("passes through aspects inside the band", () => {
    expect(clampAspect(1)).toBe(1);
    expect(clampAspect(16 / 9)).toBeCloseTo(16 / 9, 4);
    expect(clampAspect(9 / 16)).toBeCloseTo(9 / 16, 4);
  });

  test("clamps extremes and rejects non-positive input", () => {
    expect(clampAspect(99)).toBe(MAX_ASPECT);
    expect(clampAspect(0.01)).toBe(MIN_ASPECT);
    expect(clampAspect(0)).toBe(1);
    expect(clampAspect(-3)).toBe(1);
    expect(clampAspect(Number.NaN)).toBe(1);
  });
});

describe("columnWidth", () => {
  test("subtracts gaps before dividing", () => {
    expect(columnWidth(geometry4col1200())).toBeCloseTo(
      (1200 - 14 * 3) / 4,
      4,
    );
  });

  test("returns 0 for invalid column counts", () => {
    expect(columnWidth({ contentWidth: 800, columnCount: 0, gap: 12 })).toBe(0);
  });
});

describe("rowSpanForHeight", () => {
  test("a card of height H occupies just enough rows", () => {
    const gap = 14;
    const cardH = 180;
    const span = rowSpanForHeight(cardH, gap);
    const reserved = span * ROW_UNIT_PX + (span - 1) * gap;
    expect(reserved).toBeGreaterThanOrEqual(cardH);
    expect(reserved - cardH).toBeLessThan(ROW_UNIT_PX + gap);
  });

  test("returns at least 1 row for non-positive heights", () => {
    expect(rowSpanForHeight(0, 14)).toBe(1);
    expect(rowSpanForHeight(-5, 14)).toBe(1);
    expect(rowSpanForHeight(Number.NaN, 14)).toBe(1);
  });
});

describe("computeCellLayout", () => {
  test("images span one column and videos span two columns when available", () => {
    const geom = geometry4col1200();
    const images: LayoutInput[] = [
      { width: 1080, height: 1920, kind: "image" },
      { width: 512, height: 512, kind: "image" },
      {},
    ];
    for (const item of images) {
      const layout = computeCellLayout(item, geom);
      expect(layout.colSpan).toBe(1);
    }
    expect(
      computeCellLayout({ width: 1920, height: 1080, kind: "video" }, geom)
        .colSpan,
    ).toBe(2);
  });

  test("portrait images reserve more vertical space than landscape images", () => {
    const geom = geometry4col1200();
    const portrait = computeCellLayout(
      { width: 1080, height: 1920 },
      geom,
    );
    const landscape = computeCellLayout(
      { width: 1920, height: 1080 },
      geom,
    );
    expect(portrait.rowSpan).toBeGreaterThan(landscape.rowSpan);
  });

  test("reserved height keeps the native video aspect in a wider card", () => {
    const geom = geometry4col1200();
    const item: LayoutInput = { width: 1920, height: 1080, kind: "video" };
    const layout = computeCellLayout(item, geom);
    const colW = columnWidth(geom);
    const expectedW = colW * layout.colSpan + geom.gap * (layout.colSpan - 1);
    const expectedH = expectedW / (1920 / 1080);
    const reserved = reservedHeightForCell(layout, geom.gap);
    expect(layout.colSpan).toBe(2);
    expect(reserved).toBeGreaterThanOrEqual(expectedH);
    expect(reserved - expectedH).toBeLessThan(ROW_UNIT_PX + geom.gap);
  });

  test("video cards are larger by width, not by aspect distortion", () => {
    const geom = geometry4col1200();
    const video = computeCellLayout(
      { width: 1920, height: 1080, kind: "video" },
      geom,
    );
    const image = computeCellLayout(
      { width: 1920, height: 1080, kind: "image" },
      geom,
    );
    const videoH = reservedHeightForCell(video, geom.gap);
    const imageH = reservedHeightForCell(image, geom.gap);

    expect(video.colSpan).toBe(2);
    expect(image.colSpan).toBe(1);
    expect(videoH / imageH).toBeGreaterThan(1.9);
    expect(videoH / imageH).toBeLessThan(2.2);
  });

  test("falls back gracefully when geometry is not yet measured", () => {
    const layout = computeCellLayout(
      { width: 1920, height: 1080 },
      { contentWidth: 0, columnCount: 4, gap: 14 },
    );
    expect(layout).toEqual({ colSpan: 1, rowSpan: 1 });
  });
});

describe("packMasonry — dense flow supports wider video cards", () => {
  test("a mixed gallery of videos and images packs without leaving any column gaps", () => {
    const geom = geometry4col1200();
    const gallery: LayoutInput[] = [
      { width: 1920, height: 1080, kind: "video" },
      { width: 1080, height: 1920, kind: "image" },
      { width: 1024, height: 1024, kind: "image" },
      { kind: "video" },
      { width: 1500, height: 1000, kind: "image" },
      { width: 720, height: 1280, kind: "video" },
      { width: 2048, height: 1152, kind: "video" },
      { width: 800, height: 800, kind: "image" },
      {},
      { width: 1280, height: 720, kind: "video" },
    ];

    const result = packMasonry(gallery, geom);

    // Every item must land within a real column.
    for (const placement of result.placements) {
      expect(placement.column).toBeGreaterThanOrEqual(0);
      expect(placement.column + placement.colSpan).toBeLessThanOrEqual(
        geom.columnCount,
      );
      expect(placement.colSpan).toBeGreaterThanOrEqual(1);
      expect(placement.rowSpan).toBeGreaterThanOrEqual(1);
    }
    const occupiedCells = new Set<string>();
    const rowsByColumn = new Map<number, Set<number>>();
    for (const placement of result.placements) {
      for (
        let col = placement.column;
        col < placement.column + placement.colSpan;
        col += 1
      ) {
        const rows = rowsByColumn.get(col) ?? new Set<number>();
        for (
          let row = placement.startRow;
          row < placement.startRow + placement.rowSpan;
          row += 1
        ) {
          const key = `${row}:${col}`;
          expect(occupiedCells.has(key)).toBe(false);
          occupiedCells.add(key);
          rows.add(row);
        }
        rowsByColumn.set(col, rows);
      }
    }

    for (const rows of rowsByColumn.values()) {
      const bottomRow = Math.max(...rows);
      let missingRun = 0;
      let maxMissingRun = 0;
      for (let row = 1; row <= bottomRow; row += 1) {
        if (rows.has(row)) {
          missingRun = 0;
        } else {
          missingRun += 1;
          maxMissingRun = Math.max(maxMissingRun, missingRun);
        }
      }
      expect(maxMissingRun).toBeLessThanOrEqual(1);
    }
  });

  test("only-videos sequence packs across all columns (the prior buggy case)", () => {
    const geom = geometry4col1200();
    const onlyVideos: LayoutInput[] = Array.from({ length: 12 }, () => ({
      width: 1920,
      height: 1080,
      kind: "video" as const,
    }));
    const result = packMasonry(onlyVideos, geom);
    for (const placement of result.placements) {
      expect(placement.colSpan).toBe(VIDEO_CARD_COLUMN_SPAN);
    }
    const columnsCovered = new Set<number>();
    for (const placement of result.placements) {
      for (
        let col = placement.column;
        col < placement.column + placement.colSpan;
        col += 1
      ) {
        columnsCovered.add(col);
      }
    }
    expect(columnsCovered.size).toBe(geom.columnCount);
  });

  test("packs tightly across a single-pillar filter (e.g. all designs)", () => {
    const geom = geometry4col1200();
    const designs: LayoutInput[] = Array.from({ length: 16 }, (_, i) => ({
      width: i % 3 === 0 ? 1080 : 1600,
      height: i % 3 === 0 ? 1920 : 1000,
      kind: "image" as const,
    }));
    const result = packMasonry(designs, geom);
    expect(result.placements).toHaveLength(designs.length);
    // No item should jump more than a few rows past the next-shortest column —
    // dense flow rule.
    const startRows = result.placements.map((p) => p.startRow);
    expect(Math.min(...startRows)).toBe(1);
  });
});
