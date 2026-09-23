import { describe, expect, test } from "bun:test";
import { mediumOf } from "../lib/medium";

describe("mediumOf", () => {
  test("anything tagged animation is animation", () => {
    expect(mediumOf(["Animation", "cinematic"])).toBe("animation");
    expect(mediumOf(["#animation"])).toBe("animation");
  });

  test("everything else is live action, tagged or not", () => {
    expect(mediumOf(["live action"])).toBe("live-action");
    expect(mediumOf(["cinematic", "scene"])).toBe("live-action");
    expect(mediumOf([])).toBe("live-action");
    expect(mediumOf(undefined)).toBe("live-action");
  });
});
