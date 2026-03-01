import { describe, expect, test } from "bun:test";
import { formatAssetCreatedAt, resolvePillarLabel } from "@/lib/gallery-focus";

describe("gallery focus helpers", () => {
  test("resolvePillarLabel maps known pillar values", () => {
    expect(resolvePillarLabel("creators")).toBe("Creators");
    expect(resolvePillarLabel("cars")).toBe("Cars");
    expect(resolvePillarLabel("designs")).toBe("Designs");
    expect(resolvePillarLabel("dump")).toBe("Dump");
  });

  test("resolvePillarLabel falls back for unknown values", () => {
    expect(resolvePillarLabel("custom-pillar")).toBe("custom-pillar");
    expect(resolvePillarLabel(undefined)).toBeUndefined();
  });

  test("formatAssetCreatedAt returns a human-readable timestamp", () => {
    const formatted = formatAssetCreatedAt(1704067200000); // 2024-01-01T00:00:00.000Z
    expect(typeof formatted).toBe("string");
    expect((formatted ?? "").length).toBeGreaterThan(0);
  });

  test("formatAssetCreatedAt returns undefined for invalid input", () => {
    expect(formatAssetCreatedAt(undefined)).toBeUndefined();
    expect(formatAssetCreatedAt(Number.NaN)).toBeUndefined();
  });
});
