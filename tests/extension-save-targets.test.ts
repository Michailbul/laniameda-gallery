import { beforeAll, describe, expect, test } from "bun:test";

type SaveTargetsApi = {
  buildQuickSave: (
    kind: string,
    worldId: string,
  ) => { folderId: string; folderIds: string[]; tagNames: string[]; label: string };
  worldIdFromList: (worlds: Array<{ key?: string; worldId?: string }>) => string;
};

const getApi = () =>
  (globalThis as typeof globalThis & { SaveToGallerySaveTargets: SaveTargetsApi })
    .SaveToGallerySaveTargets;

beforeAll(async () => {
  await import("../extension/save-targets.js");
});

describe("Dear Annete quick saves", () => {
  test("finds the world by key", () => {
    expect(
      getApi().worldIdFromList([
        { key: "cassandra", worldId: "other" },
        { key: "dear-annete", worldId: "world1" },
      ]),
    ).toBe("world1");
  });

  test("files a plain add on the world root", () => {
    expect(getApi().buildQuickSave("world", "world1")).toEqual({
      folderId: "world1",
      folderIds: ["world1"],
      tagNames: [],
      label: "Dear Annete",
    });
  });

  test("location and scene keep the world and add the tag", () => {
    expect(getApi().buildQuickSave("location", "world1").tagNames).toEqual(["location"]);
    expect(getApi().buildQuickSave("scene", "world1").tagNames).toEqual(["scene"]);
    expect(getApi().buildQuickSave("location", "world1").folderIds).toEqual(["world1"]);
  });

  test("refuses a save with no world", () => {
    expect(() => getApi().buildQuickSave("world", "")).toThrow(/not found/);
  });
});
