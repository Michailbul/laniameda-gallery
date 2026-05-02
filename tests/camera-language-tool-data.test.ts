import { describe, expect, test } from "bun:test";
import {
  cameraMoveCategories,
  cameraMoveThumbnailPrompts,
  cameraMoves,
  getCameraMoveThumbnailPrompt,
} from "../lib/tools/camera-language";

describe("camera language tool data", () => {
  test("packages the expected movement library", () => {
    expect(cameraMoves).toHaveLength(30);
    expect(cameraMoveCategories).toHaveLength(6);
  });

  test("uses stable unique slugs and prompt lines", () => {
    const slugs = new Set(cameraMoves.map((move) => move.slug));
    expect(slugs.size).toBe(cameraMoves.length);

    for (const move of cameraMoves) {
      expect(move.prompt.trim().length).toBeGreaterThan(12);
      expect(move.useFor.trim().length).toBeGreaterThan(12);
    }
  });

  test("has one Nano Banana thumbnail prompt for every move", () => {
    const thumbnailSlugs = new Set(Object.keys(cameraMoveThumbnailPrompts));
    expect(thumbnailSlugs.size).toBe(cameraMoves.length);

    for (const move of cameraMoves) {
      const prompt = getCameraMoveThumbnailPrompt(move);
      expect(prompt).toContain("16:9");
      expect(prompt.toLowerCase()).toContain("avoid: text");
      expect(prompt).toContain("Avoid:");
      expect(prompt.length).toBeGreaterThan(260);
    }
  });
});
