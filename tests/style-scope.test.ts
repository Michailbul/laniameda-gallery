import { expect, test } from "bun:test";

import {
  buildStyleShelfStacks,
  filterAssetsToStyle,
  resolveFoldersViewWorld,
  resolveWorldStyleScope,
} from "../lib/style-scope";

// DEAR ANNETE as it is filed: two live style branches, one empty merged one,
// shelves in other groups, and an ungrouped child.
const folders = [
  { _id: "world", name: "DEAR ANNETE" },
  { _id: "film", name: "Film · Live Action", parentFolderId: "world", group: "Styles", sortOrder: 10, count: 935 },
  { _id: "3d", name: "3D Animation", parentFolderId: "world", group: "Styles", sortOrder: 11, count: 210 },
  { _id: "crimson", name: "Crimson Painted", parentFolderId: "world", group: "Styles", sortOrder: 13, count: 0 },
  { _id: "streets", name: "Streets, Markets & Courtyards", parentFolderId: "world", group: "Places", sortOrder: 20 },
  { _id: "night", name: "Night, Rain & Lamplight", parentFolderId: "world", group: "Moods", sortOrder: 50 },
  { _id: "cast", name: "Court & City", parentFolderId: "world", group: "Cast", sortOrder: 30 },
  { _id: "loose", name: "Loose", parentFolderId: "world" },
  { _id: "pets", name: "Pets" },
];

test("a style branch is its own scope and lists the world's shelves", () => {
  const scope = resolveWorldStyleScope({ folders, activeFolderId: "film" });
  expect(scope?.worldId).toBe("world");
  expect(scope?.atStyleBranch).toBe(true);
  expect(scope?.activeStyleId).toBe("film");
  expect(scope?.styles.map((style) => style._id)).toEqual(["film", "3d"]);
  expect(scope?.shelves.map((shelf) => shelf._id)).toEqual([
    "streets",
    "cast",
    "night",
    "loose",
  ]);
});

test("a remembered style applies on a shelf of the same world only", () => {
  const remembered = { worldId: "world", styleId: "3d" };
  expect(
    resolveWorldStyleScope({ folders, activeFolderId: "streets", rememberedStyle: remembered })
      ?.activeStyleId,
  ).toBe("3d");
  expect(
    resolveWorldStyleScope({ folders, activeFolderId: "world", rememberedStyle: remembered })
      ?.activeStyleId,
  ).toBeNull();
  expect(
    resolveWorldStyleScope({
      folders,
      activeFolderId: "streets",
      rememberedStyle: { worldId: "other", styleId: "3d" },
    })?.activeStyleId,
  ).toBeNull();
  expect(
    resolveWorldStyleScope({
      folders,
      activeFolderId: "streets",
      rememberedStyle: { worldId: "world", styleId: "crimson" },
    })?.activeStyleId,
  ).toBeNull();
});

test("no scope outside a world or in a world without styles", () => {
  expect(resolveWorldStyleScope({ folders, activeFolderId: "pets" })).toBeNull();
  expect(resolveWorldStyleScope({ folders, activeFolderId: null })).toBeNull();
  const plain = [
    { _id: "w", name: "W" },
    { _id: "a", name: "A", parentFolderId: "w", group: "Places" },
  ];
  expect(resolveWorldStyleScope({ folders: plain, activeFolderId: "a" })).toBeNull();
});

test("filterAssetsToStyle keeps members of the branch only", () => {
  const assets = [
    { id: 1, folderIds: ["film", "world", "streets"] },
    { id: 2, folderIds: ["3d", "world", "streets"] },
    { id: 3, folderId: "film" },
  ];
  expect(filterAssetsToStyle(assets, "film").map((asset) => asset.id)).toEqual([1, 3]);
  expect(filterAssetsToStyle(assets, null)).toHaveLength(3);
});

test("buildStyleShelfStacks counts a branch's pieces per shelf and drops empty shelves", () => {
  const shelves = folders.filter((folder) =>
    ["streets", "night", "cast"].includes(folder._id),
  );
  const assets = [
    { id: "a", folderIds: ["film", "world", "streets", "night"] },
    { id: "b", folderIds: ["film", "world", "streets"] },
    { id: "c", folderIds: ["film", "world"] },
  ];
  const stacks = buildStyleShelfStacks(shelves, assets, 1);
  expect(stacks.map((stack) => [stack.shelf._id, stack.count])).toEqual([
    ["streets", 2],
    ["night", 1],
  ]);
  expect(stacks[0].previews.map((asset) => asset.id)).toEqual(["a"]);
});

test("the folders view inside a world stays in that world", () => {
  expect(resolveFoldersViewWorld(folders, "world")).toBe("world");
  expect(resolveFoldersViewWorld(folders, "streets")).toBe("world");
  expect(resolveFoldersViewWorld(folders, "pets")).toBeNull();
  expect(resolveFoldersViewWorld(folders, null)).toBeNull();
});
