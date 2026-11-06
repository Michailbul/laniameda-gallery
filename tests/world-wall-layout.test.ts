import { describe, expect, test } from "bun:test";

import {
  MAX_STRETCH,
  layoutWall,
  type WallBox,
  type WallInput,
} from "../components/world-page/wall-layout";
import { editHeroInserts, normalizeHeroInserts, separateFilms } from "../lib/world-hero-inserts";

// A mix like the DEAR ANNETE wall: mostly 16:9 stills, some portraits, a few squares.
const mixed = (count: number) =>
  Array.from({ length: count }, (_, i) => [0.5625, 0.5625, 1.5, 0.5625, 1, 0.42, 1.25][i % 7]);

const base = (over: Partial<WallInput> = {}): WallInput => ({
  ratios: mixed(60),
  inserts: 5,
  width: 1280,
  gap: 4,
  insertHeight: 1120,
  complete: true,
  ...over,
});

const columnBottomsAbove = (boxes: WallBox[], y: number) => {
  const bottoms = new Map<number, number>();
  for (const box of boxes) {
    if (box.kind === "insert" || box.y >= y) continue;
    bottoms.set(box.x, Math.max(bottoms.get(box.x) ?? 0, box.y + box.h));
  }
  return [...bottoms.values()];
};

describe("layoutWall", () => {
  test("every chunk ends level above its insert: no holes", () => {
    for (const width of [390, 1280, 1920]) {
      const { boxes } = layoutWall(base({ width }));
      const inserts = boxes.filter((box) => box.kind === "insert");
      expect(inserts.length).toBeGreaterThan(0);
      for (const insert of inserts) {
        const bottoms = columnBottomsAbove(boxes, insert.y);
        const level = insert.y - 4;
        for (const bottom of bottoms) expect(Math.abs(bottom - level)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("the final chunk ends level once every frame is loaded", () => {
    const layout = layoutWall(base({ ratios: mixed(41) }));
    const bottoms = columnBottomsAbove(layout.boxes, Infinity);
    for (const bottom of bottoms) expect(Math.abs(bottom - layout.height)).toBeLessThanOrEqual(1);
  });

  test("tiles never overlap and stay inside the width", () => {
    const { boxes } = layoutWall(base({ ratios: mixed(80), width: 1500 }));
    const flat = boxes.filter((box) => box.kind !== "insert");
    for (const a of flat) {
      expect(a.x + a.w).toBeLessThanOrEqual(1501);
      for (const b of flat) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  test("a stretched frame grows at most 35%, or 60% to close a small remainder", () => {
    const width = 1280;
    const layout = layoutWall(base({ width }));
    for (const box of layout.boxes) {
      if (box.kind !== "tile") continue;
      const natural = Math.round(layout.colW * Math.min(2.4, Math.max(0.3, mixed(60)[box.index])));
      const grew = box.h - natural;
      if (grew > natural * MAX_STRETCH + 1) expect(grew).toBeLessThanOrEqual(natural * 0.6 + 1);
    }
  });

  test("inserts sit between chunks, in order, and never after the last chunk", () => {
    const { boxes } = layoutWall(base({ ratios: mixed(18 * 3), inserts: 9 }));
    const inserts = boxes.filter((box) => box.kind === "insert");
    expect(inserts.map((box) => (box.kind === "insert" ? box.insert : -1))).toEqual([0, 1]);
  });

  test("an open chunk while pages load gets no insert and no filler yet", () => {
    const { boxes } = layoutWall(base({ ratios: mixed(18), complete: false }));
    expect(boxes.some((box) => box.kind === "insert" || box.kind === "filler")).toBe(false);
  });

  test("a tiny last chunk joins the one before once loading is done", () => {
    const loaded = layoutWall(base({ ratios: mixed(18 + 3), complete: true }));
    expect(loaded.boxes.some((box) => box.kind === "insert")).toBe(false);
  });

  test("runs out of inserts gracefully", () => {
    const { boxes } = layoutWall(base({ ratios: mixed(18 * 4), inserts: 1 }));
    expect(boxes.filter((box) => box.kind === "insert")).toHaveLength(1);
  });
});

describe("editHeroInserts", () => {
  test("toggle adds a full insert, then removes it", () => {
    const added = editHeroInserts([], "a", "toggle");
    expect(added.inserts).toEqual([{ assetIds: ["a"] }]);
    expect(added).toMatchObject({ hero: true, index: 0, frames: 1, changed: true });
    const removed = editHeroInserts(added.inserts, "a", "toggle");
    expect(removed.inserts).toEqual([]);
    expect(removed.hero).toBe(false);
  });

  test("add and remove are idempotent", () => {
    const once = editHeroInserts([{ assetIds: ["a"] }], "a", "add");
    expect(once.changed).toBe(false);
    expect(editHeroInserts([], "a", "remove").changed).toBe(false);
  });

  test("pair joins the previous insert into a split, then a triptych, then starts anew", () => {
    let list = editHeroInserts([], "a", "add").inserts;
    const split = editHeroInserts(list, "b", "pair");
    expect(split.inserts).toEqual([{ assetIds: ["a", "b"] }]);
    expect(split.frames).toBe(2);
    list = editHeroInserts(split.inserts, "c", "pair").inserts;
    expect(list).toEqual([{ assetIds: ["a", "b", "c"] }]);
    const next = editHeroInserts(list, "d", "pair");
    expect(next.inserts).toEqual([{ assetIds: ["a", "b", "c"] }, { assetIds: ["d"] }]);
    expect(next.index).toBe(1);
  });

  test("pairing a lone last insert moves it into the one before", () => {
    const result = editHeroInserts([{ assetIds: ["a"] }, { assetIds: ["b"] }], "b", "pair");
    expect(result.inserts).toEqual([{ assetIds: ["a", "b"] }]);
  });

  test("removing a frame from a split leaves the other frame full", () => {
    const result = editHeroInserts([{ assetIds: ["a", "b"] }, { assetIds: ["c"] }], "a", "remove");
    expect(result.inserts).toEqual([{ assetIds: ["b"] }, { assetIds: ["c"] }]);
  });

  test("normalize drops repeats and caps an insert at three frames", () => {
    expect(
      normalizeHeroInserts([{ assetIds: ["a", "b", "c", "d"] }, { assetIds: ["a"] }, { assetIds: [] }]),
    ).toEqual([{ assetIds: ["a", "b", "c"] }]);
  });
});

describe("films are never cropped", () => {
  test("a film tile keeps its exact aspect while the chunk still ends level", () => {
    const ratios = mixed(60);
    const locked = ratios.map((_, i) => i % 3 === 0);
    const layout = layoutWall(base({ ratios, locked }));
    for (const box of layout.boxes) {
      if (box.kind !== "tile" || !locked[box.index]) continue;
      const natural = Math.round(layout.colW * Math.min(2.4, Math.max(0.3, ratios[box.index])));
      expect(box.h).toBe(natural);
    }
    for (const insert of layout.boxes.filter((box) => box.kind === "insert")) {
      for (const bottom of columnBottomsAbove(layout.boxes, insert.y)) {
        expect(Math.abs(bottom - (insert.y - 4))).toBeLessThanOrEqual(1);
      }
    }
  });

  test("a film insert takes its own height", () => {
    const { boxes } = layoutWall(base({ ratios: mixed(60), inserts: 2, insertHeights: [720, 1120] }));
    const heights = boxes.filter((box) => box.kind === "insert").map((box) => box.h);
    expect(heights).toEqual([720, 1120]);
  });
});

describe("hero inserts keep films whole", () => {
  test("pairing a film makes it its own insert; a still never joins a film", () => {
    const films = new Set(["v"]);
    const isVideo = (id: string) => films.has(id);
    const film = editHeroInserts([{ assetIds: ["a"] }], "v", "pair", isVideo);
    expect(film.inserts).toEqual([{ assetIds: ["a"] }, { assetIds: ["v"] }]);
    const still = editHeroInserts(film.inserts, "b", "pair", isVideo);
    expect(still.inserts).toEqual([{ assetIds: ["a"] }, { assetIds: ["v"] }, { assetIds: ["b"] }]);
  });

  test("a stored split with a film plays the film as its own insert", () => {
    const tile = (id: string, kind: "image" | "video") => ({ id, kind });
    const out = separateFilms(
      [{ tiles: [tile("a", "image"), tile("v", "video"), tile("b", "image")] }, { tiles: [tile("c", "image")] }],
      (t) => t.kind === "video",
    );
    expect(out.map((insert) => insert.tiles.map((t) => t.id))).toEqual([["a", "b"], ["v"], ["c"]]);
  });
});
