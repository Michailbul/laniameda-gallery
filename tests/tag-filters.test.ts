import { describe, expect, test } from "bun:test";
import {
  getNextSelectedTagFilters,
  resolveTagFilterModeFromClickPosition,
  type SelectedTagFilters,
} from "@/lib/tag-filters";

describe("resolveTagFilterModeFromClickPosition", () => {
  test("returns include for center clicks", () => {
    expect(resolveTagFilterModeFromClickPosition(100, 50)).toBe("include");
  });

  test("returns exclude for right-edge clicks", () => {
    expect(resolveTagFilterModeFromClickPosition(100, 90)).toBe("exclude");
  });
});

describe("getNextSelectedTagFilters", () => {
  test("adds include mode when tag is not selected", () => {
    const next = getNextSelectedTagFilters({}, "tag-a", "include");
    expect(next).toEqual({ "tag-a": "include" });
  });

  test("removes tag when selecting the same mode twice", () => {
    const previous: SelectedTagFilters = { "tag-a": "exclude" };
    const next = getNextSelectedTagFilters(previous, "tag-a", "exclude");
    expect(next).toEqual({});
  });

  test("switches between include and exclude", () => {
    const previous: SelectedTagFilters = { "tag-a": "include" };
    const next = getNextSelectedTagFilters(previous, "tag-a", "exclude");
    expect(next).toEqual({ "tag-a": "exclude" });
  });
});
