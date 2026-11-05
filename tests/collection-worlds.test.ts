import { describe, expect, test } from "bun:test";

import {
  collectionNameMatches,
  isWorldCollection,
  orderRootCollections,
  partitionWorlds,
} from "@/lib/collection-worlds";

describe("collection worlds", () => {
  test("a root is a world when marked World or showcased", () => {
    expect(isWorldCollection({ name: "DEAR ANNETE", showcased: true })).toBe(true);
    expect(isWorldCollection({ name: "ANDROMEDA — ANYA", group: "world" })).toBe(true);
    expect(isWorldCollection({ name: "ART" })).toBe(false);
    // A child is never a world, whatever its group says.
    expect(
      isWorldCollection({ name: "Liz", parentFolderId: "p", group: "World" }),
    ).toBe(false);
  });

  test("worlds lead, then pinned, sortOrder and name", () => {
    const ordered = orderRootCollections([
      { name: "ART" },
      { name: "Cars" },
      { name: "TECHNIQUES", pinnedAt: 5 },
      { name: "DEAR ANNETE", showcased: true },
      { name: "ANDROMEDA — ANYA", group: "World", sortOrder: 2 },
      { name: "CASSANDRA", group: "World", sortOrder: 1 },
    ]).map((root) => root.name);
    expect(ordered).toEqual([
      "CASSANDRA",
      "ANDROMEDA — ANYA",
      "DEAR ANNETE",
      "TECHNIQUES",
      "ART",
      "Cars",
    ]);
  });

  test("partition keeps both halves in root order", () => {
    const { worlds, collections } = partitionWorlds([
      { name: "LOVE" },
      { name: "ORPHEUS", group: "World" },
      { name: "ART" },
    ]);
    expect(worlds.map((root) => root.name)).toEqual(["ORPHEUS"]);
    expect(collections.map((root) => root.name)).toEqual(["ART", "LOVE"]);
  });

  test("search ignores case and accents", () => {
    expect(collectionNameMatches("HOCKEY ANIMATION — RYTÍŘI Z TELČE", "rytiri")).toBe(true);
    expect(collectionNameMatches("ART", "  ")).toBe(true);
    expect(collectionNameMatches("ART", "love")).toBe(false);
  });
});
