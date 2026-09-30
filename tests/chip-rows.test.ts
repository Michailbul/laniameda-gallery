import { describe, expect, test } from "bun:test";
import { fitChipsInRows } from "../lib/chip-rows";

const base = { rowWidth: 100, gap: 10, maxRows: 2, moreWidth: 20 };

describe("fitChipsInRows", () => {
  test("keeps every chip when they all fit", () => {
    expect(fitChipsInRows({ ...base, widths: [40, 40, 40, 40] })).toBe(4);
  });

  test("keeps no chips out when there are none", () => {
    expect(fitChipsInRows({ ...base, widths: [] })).toBe(0);
  });

  test("stops at the row limit and leaves room for the +N chip", () => {
    // Row 1: 40+40. Row 2: 40+40 would be full, so the +N chip bumps the last one.
    expect(fitChipsInRows({ ...base, widths: [40, 40, 40, 40, 40] })).toBe(3);
  });

  test("uses the space the +N chip does not need", () => {
    // Row 2: 30 + 30 + more(20) = 30+10+30+10+20 = 100.
    expect(fitChipsInRows({ ...base, widths: [45, 45, 30, 30, 30] })).toBe(4);
  });

  test("a chip wider than the row takes one line", () => {
    expect(fitChipsInRows({ ...base, widths: [300, 300, 300] })).toBe(1);
  });

  test("unmeasured rows show everything", () => {
    expect(
      fitChipsInRows({ ...base, rowWidth: 0, widths: [40, 40, 40, 40, 40] }),
    ).toBe(5);
  });
});
