import { describe, expect, test } from "bun:test";

import { browseHitCount, buildBrowseTree, filterBrowseSections } from "@/lib/mobile-browse";

const folders = [
  { _id: "da", name: "DEAR ANNETE", group: "World", count: 1140 },
  { _id: "art", name: "ART", count: 300 },
  { _id: "cast", name: "Cast", parentFolderId: "da", group: "Cast", sortOrder: 2 },
  { _id: "styles", name: "DA FILM", parentFolderId: "da", group: "Styles", sortOrder: 1 },
  { _id: "places", name: "Prague tram stop", parentFolderId: "da", group: "Places", sortOrder: 3 },
  { _id: "deco", name: "Art Deco plates", parentFolderId: "art" },
  { _id: "orphan", name: "Loose", parentFolderId: "gone" },
];

const sections = [
  { key: "storybooks", label: "Storybooks", hint: "Episodes ready to shoot" },
  { key: "skills", label: "Skills", hint: "Techniques and recipes" },
  { key: "youtube", label: "YouTube", hint: "Channel research", href: "/youtube" },
];

describe("mobile browse tree", () => {
  test("worlds lead, shelves come grouped, a child without a parent is a root", () => {
    const tree = buildBrowseTree(folders);
    expect(tree.worlds.map((root) => root.folder._id)).toEqual(["da"]);
    expect(tree.worlds[0].children.map((child) => child._id)).toEqual(["styles", "cast", "places"]);
    expect(tree.collections.map((root) => root.folder._id)).toEqual(["art", "orphan"]);
    expect(tree.worlds[0].forcedOpen).toBe(false);
  });

  test("a search keeps a root by its own name or opens it on its matching shelves", () => {
    const byShelf = buildBrowseTree(folders, "tram");
    expect(byShelf.worlds).toHaveLength(1);
    expect(byShelf.worlds[0].children.map((child) => child._id)).toEqual(["places"]);
    expect(byShelf.worlds[0].forcedOpen).toBe(true);
    expect(byShelf.collections).toHaveLength(0);

    const byRoot = buildBrowseTree(folders, "art");
    expect(byRoot.collections.map((root) => root.folder._id)).toEqual(["art"]);
    expect(byRoot.collections[0].children).toHaveLength(1);
    expect(byRoot.collections[0].forcedOpen).toBe(true);

    expect(buildBrowseTree(folders, "zzz").worlds).toHaveLength(0);
  });

  test("sections filter by label or hint and the hit count covers both lists", () => {
    expect(filterBrowseSections(sections, "").map((s) => s.key)).toEqual(["storybooks", "skills", "youtube"]);
    expect(filterBrowseSections(sections, "recipe").map((s) => s.key)).toEqual(["skills"]);
    expect(browseHitCount(buildBrowseTree(folders, "zzz"), filterBrowseSections(sections, "zzz"))).toBe(0);
    expect(browseHitCount(buildBrowseTree(folders, "art"), filterBrowseSections(sections, "art"))).toBe(1);
  });
});
