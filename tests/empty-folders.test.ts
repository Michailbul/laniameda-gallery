import { expect, test } from "bun:test";

import { findEmptiedFolders, folderLoads } from "../lib/empty-folders";

const folders = [
  { _id: "world" },
  { _id: "streets", parentFolderId: "world" },
  { _id: "night", parentFolderId: "world" },
  { _id: "book", kind: "storybook" },
  { _id: "crimson", parentFolderId: "world" },
];

test("a collection's load counts its assets and its child collections", () => {
  const loads = folderLoads(folders, new Map([["streets", 3], ["world", 0]]));
  expect(loads.get("world")).toBe(3);
  expect(loads.get("streets")).toBe(3);
  expect(loads.get("night")).toBe(0);
  expect(loads.has("book")).toBe(false);
});

test("only folders that drop to zero are reported, never ones that were empty", () => {
  const before = folderLoads(folders, new Map([["streets", 2], ["night", 1]]));
  const after = folderLoads(folders, new Map([["streets", 0], ["night", 1]]));
  expect(findEmptiedFolders(before, after)).toEqual(["streets"]);
  expect(findEmptiedFolders(null, after)).toEqual([]);
});

test("a world empties once its last asset and last child collection are gone", () => {
  const withChild = folderLoads([{ _id: "w" }, { _id: "c", parentFolderId: "w" }], new Map());
  const childDeleted = folderLoads([{ _id: "w" }], new Map());
  expect(findEmptiedFolders(withChild, childDeleted)).toEqual(["w"]);
});
