import { describe, expect, test } from "bun:test";
import { aspectOf, fitGrid } from "../components/inbox/evidence";

// The desk sizes evidence to the measured area: real pictures at their own
// aspect, no letterboxed box, the first row never taller than the area.
const wide = { width: 1600, height: 900 };
const tall = { width: 900, height: 1600 };
const area = { w: 1400, h: 800 };

describe("fitGrid", () => {
  test("one image fills the width up to the area's height", () => {
    const fit = fitGrid([wide], area);
    expect(fit.cols).toBe(1);
    expect(fit.tile).toBe(area.w);
    expect(fit.tile / aspectOf(wide)).toBeLessThanOrEqual(area.h + 0.01);
    // A shorter desk caps the width so the picture never scrolls.
    expect(fitGrid([wide], { w: 1400, h: 600 }).tile).toBeCloseTo(600 * (16 / 9), 3);
    expect(fitGrid([tall], area).tile).toBeCloseTo(800 * (9 / 16), 3);
  });

  test("two candidates sit side by side at one width", () => {
    const pair = fitGrid([wide, wide], area);
    expect(pair.cols).toBe(2);
    expect(pair.tile).toBe((area.w - pair.gap) / 2);
    // A pair of portraits is capped so both fit without scrolling.
    const portraits = fitGrid([tall, tall], area);
    expect(portraits.cols).toBe(2);
    expect(portraits.tile).toBeCloseTo(800 * (9 / 16), 3);
  });

  test("columns grow with the count, never past the area", () => {
    expect(fitGrid([wide, wide, wide], area).cols).toBe(3);
    expect(fitGrid([wide, wide, wide, wide], area).cols).toBe(2);
    expect(fitGrid([tall, tall, tall, tall], area).cols).toBe(4);
    expect(fitGrid(Array(6).fill(wide), area).cols).toBe(3);
    expect(fitGrid(Array(8).fill(wide), area).cols).toBe(4);
    expect(fitGrid(Array(12).fill(tall), area).cols).toBe(5);
    for (const count of [2, 3, 4, 6, 8, 12]) {
      const fit = fitGrid(Array(count).fill(wide), area);
      expect(fit.cols * fit.tile + (fit.cols - 1) * fit.gap).toBeLessThanOrEqual(area.w + 0.01);
    }
  });

  test("an image without dimensions counts as square", () => {
    expect(aspectOf({})).toBe(1);
    expect(aspectOf({}, 16 / 9)).toBeCloseTo(16 / 9, 6);
    expect(fitGrid([{}], area).tile).toBe(800);
  });
});
