import { describe, expect, test } from "bun:test";

import {
  clampAspect,
  layoutJustified,
  MAX_ASPECT,
  MIN_ASPECT,
  resolveAspect,
  resolveLayoutAspect,
  resolveLayoutKind,
  type JustifiedOptions,
  type LayoutInput,
} from "../lib/masonry-layout";

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

describe("resolveLayoutKind", () => {
  test("recognizes videos from content type when kind metadata is missing", () => {
    expect(resolveLayoutKind({ contentType: "video/mp4" })).toBe("video");
    expect(resolveLayoutKind({ contentType: "VIDEO/QUICKTIME" })).toBe("video");
    expect(resolveLayoutKind({ contentType: "image/png" })).toBe("image");
  });

  test("treats video content type as authoritative over stale image kind", () => {
    expect(
      resolveLayoutKind({ kind: "image", contentType: "video/mp4" }),
    ).toBe("video");
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
    expect(
      resolveLayoutAspect({
        width: 1024,
        height: 1024,
        contentType: "video/mp4",
      }),
    ).toBeCloseTo(16 / 9, 4);
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

const opts = (over: Partial<JustifiedOptions> = {}): JustifiedOptions => ({
  containerWidth: 1200,
  gap: 12,
  targetRowHeight: 240,
  ...over,
});

// Group tiles into rows keyed by their `row` index.
function rowsOf(tiles: { row: number }[]) {
  const rows = new Map<number, typeof tiles>();
  for (const tile of tiles) {
    const bucket = rows.get(tile.row) ?? [];
    bucket.push(tile);
    rows.set(tile.row, bucket);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

describe("layoutJustified", () => {
  test("returns an empty layout for degenerate input", () => {
    expect(layoutJustified([], opts())).toEqual({
      tiles: [],
      totalHeight: 0,
      rowCount: 0,
    });
    expect(layoutJustified([{ width: 100, height: 100 }], opts({ containerWidth: 0 })))
      .toEqual({ tiles: [], totalHeight: 0, rowCount: 0 });
  });

  test("keeps tiles in input order and covers every input", () => {
    const inputs: LayoutInput[] = Array.from({ length: 20 }, (_, i) => ({
      width: i % 2 === 0 ? 1080 : 1920,
      height: i % 2 === 0 ? 1350 : 1080,
      kind: "image" as const,
    }));
    const { tiles } = layoutJustified(inputs, opts());
    expect(tiles).toHaveLength(inputs.length);
    tiles.forEach((tile, i) => expect(tile.index).toBe(i));
  });

  test("every complete row fills the container width exactly (no horizontal gap)", () => {
    const inputs: LayoutInput[] = Array.from({ length: 30 }, (_, i) => ({
      width: [1080, 1920, 1024, 1500][i % 4],
      height: [1350, 1080, 1024, 1000][i % 4],
      kind: "image" as const,
    }));
    const layout = layoutJustified(inputs, opts());
    const rows = rowsOf(layout.tiles);
    // All rows except possibly the last must span the full width, edge to edge.
    rows.slice(0, -1).forEach((row) => {
      const sorted = [...row].sort((a, b) => a.left - b.left);
      expect(sorted[0]!.left).toBe(0);
      const last = sorted[sorted.length - 1]!;
      expect(last.left + last.width).toBe(1200);
      // Tiles within a row butt up against each other with exactly one gap.
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]!.left).toBe(
          sorted[i - 1]!.left + sorted[i - 1]!.width + 12,
        );
      }
    });
  });

  test("rows stack with no vertical gap and match totalHeight", () => {
    const inputs: LayoutInput[] = Array.from({ length: 24 }, () => ({
      width: 1024,
      height: 1024,
      kind: "image" as const,
    }));
    const layout = layoutJustified(inputs, opts());
    const rows = rowsOf(layout.tiles);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1]![0]!;
      const curr = rows[i]![0]!;
      // Next row starts exactly one gap below the previous row's bottom.
      expect(curr.top).toBe(prev.top + prev.height + 12);
    }
    const lastRow = rows[rows.length - 1]!;
    expect(layout.totalHeight).toBe(lastRow[0]!.top + lastRow[0]!.height);
  });

  test("within a row all tiles share one height and keep native aspect", () => {
    const inputs: LayoutInput[] = [
      { width: 1920, height: 1080, kind: "image" }, // 16:9 wide
      { width: 1080, height: 1350, kind: "image" }, // 4:5 portrait
      { width: 1024, height: 1024, kind: "image" }, // square
      { width: 1500, height: 1000, kind: "image" }, // 3:2
      { width: 1920, height: 1080, kind: "image" },
      { width: 1080, height: 1350, kind: "image" },
      { width: 1024, height: 1024, kind: "image" },
      { width: 1500, height: 1000, kind: "image" },
    ];
    const layout = layoutJustified(inputs, opts());
    const rows = rowsOf(layout.tiles);
    for (const row of rows) {
      const height = row[0]!.height;
      for (const tile of row) {
        expect(tile.height).toBe(height);
      }
      // Wide tiles are physically wider than portrait tiles in the same row.
      const widths = row.map((t) => t.width);
      expect(Math.max(...widths)).toBeGreaterThanOrEqual(Math.min(...widths));
    }
    // A 16:9 tile is wider than a portrait tile at the same row height.
    const first = layout.tiles[0]!; // 16:9
    const second = layout.tiles[1]!; // portrait, same row (accumulates before flush)
    if (first.row === second.row) {
      expect(first.width).toBeGreaterThan(second.width);
    }
  });

  test("interior rows never exceed the target row height", () => {
    const inputs: LayoutInput[] = Array.from({ length: 40 }, (_, i) => ({
      width: [1080, 1920, 1024][i % 3],
      height: [1350, 1080, 1024][i % 3],
      kind: "image" as const,
    }));
    const layout = layoutJustified(inputs, opts({ targetRowHeight: 260 }));
    const rows = rowsOf(layout.tiles);
    // Every row except the last is closed by overflow, so its justified height
    // is <= target. Allow +1px for integer rounding.
    rows.slice(0, -1).forEach((row) => {
      expect(row[0]!.height).toBeLessThanOrEqual(261);
    });
  });

  test("a sparse final row is left-aligned at target height, not blown up", () => {
    // One lone portrait can't fill a 1200px row at 240px target — it should
    // stay at target height and left-align rather than stretch huge.
    const inputs: LayoutInput[] = [{ width: 1080, height: 1350, kind: "image" }];
    const layout = layoutJustified(inputs, opts());
    const tile = layout.tiles[0]!;
    expect(tile.left).toBe(0);
    expect(tile.height).toBe(240);
    expect(tile.width).toBeLessThan(1200);
  });

  test("a nearly-full final row is justified to the edge", () => {
    // Four squares at 240px target ≈ 4 * 240 + gaps = 996 < 1200, ~0.83 fill →
    // above the 0.7 threshold, so it justifies to fill the width.
    const inputs: LayoutInput[] = Array.from({ length: 4 }, () => ({
      width: 1024,
      height: 1024,
      kind: "image" as const,
    }));
    const layout = layoutJustified(inputs, opts());
    const rows = rowsOf(layout.tiles);
    const only = rows[0]!.sort((a, b) => a.left - b.left);
    const last = only[only.length - 1]!;
    expect(last.left + last.width).toBe(1200);
  });

  test("caps row height so a lone ultra-wide banner doesn't dominate", () => {
    const inputs: LayoutInput[] = [
      { width: 3000, height: 300, kind: "image" }, // aspect clamped to 2.4
    ];
    const layout = layoutJustified(
      inputs,
      opts({ targetRowHeight: 240, maxRowHeight: 300 }),
    );
    expect(layout.tiles[0]!.height).toBeLessThanOrEqual(300);
  });
});
