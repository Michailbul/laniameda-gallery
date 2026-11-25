import { describe, expect, test } from "bun:test";
import { indexEntriesWithStackMembers, selectionIdsOf } from "../lib/gallery-selection";

describe("selecting stacks", () => {
  test("a plain frame is itself", () => {
    expect(selectionIdsOf({ id: "a" })).toEqual(["a"]);
    expect(selectionIdsOf({ id: "a", galleryItemType: "asset" })).toEqual(["a"]);
  });

  test("a stack is every frame in it, cover once", () => {
    const pack = { id: "c", galleryItemType: "pack" as const, previewImages: [{ id: "c" }, { id: "m1" }, { id: "m2" }] };
    expect(selectionIdsOf(pack)).toEqual(["c", "m1", "m2"]);
  });

  test("collection, storybook and skill cards are not selectable", () => {
    for (const type of ["collection", "storybook", "skill", "design"] as const) {
      expect(selectionIdsOf({ id: "x", galleryItemType: type })).toEqual([]);
    }
  });

  test("a stack's cover resolves to its own record, not the stack's union", () => {
    const pack = {
      id: "c",
      galleryItemType: "pack" as const,
      folderIds: ["shelf", "book-of-m1"],
      previewImages: [
        { id: "c", folderIds: ["shelf"] },
        { id: "m1", folderIds: ["shelf", "book-of-m1"] },
      ],
    };
    const byId = indexEntriesWithStackMembers([pack, { id: "solo", folderIds: ["x"] }]);
    expect(byId.get("c")).toMatchObject({ folderIds: ["shelf"], galleryItemType: "asset" });
    expect(byId.get("m1")).toMatchObject({ folderIds: ["shelf", "book-of-m1"] });
    expect(byId.get("solo")).toMatchObject({ folderIds: ["x"] });
  });
});
