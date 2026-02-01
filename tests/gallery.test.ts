import { describe, expect, test } from "bun:test";
import { resolveAspectRatio } from "../lib/gallery";

describe("resolveAspectRatio", () => {
  test("returns square for missing dimensions", () => {
    expect(resolveAspectRatio()).toBe("square");
    expect(resolveAspectRatio(400)).toBe("square");
  });

  test("detects wide and landscape", () => {
    expect(resolveAspectRatio(1600, 900)).toBe("wide");
    expect(resolveAspectRatio(1200, 900)).toBe("landscape");
  });

  test("detects portrait and tall", () => {
    expect(resolveAspectRatio(800, 1200)).toBe("portrait");
    expect(resolveAspectRatio(600, 1200)).toBe("tall");
  });
});
