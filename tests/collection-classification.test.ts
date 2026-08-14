import { beforeAll, describe, expect, test } from "bun:test";

import {
  applyImpliedAssetTypeTag,
  assetTypeTagForCollectionName,
  resolveImpliedAssetTypeTag,
} from "@/lib/collection-sections";

type ExtensionClassification = {
  applyImpliedAssetTypeTag: (tags: string[], impliedTag: string) => string[];
  assetTypeTagForCollectionName: (name: string) => string;
  resolveFolderAssetTypeTag: (
    folderId: string,
    folders: { _id?: string; id?: string; name?: string }[],
  ) => string;
};

const extensionApi = () =>
  (
    globalThis as typeof globalThis & {
      SaveToGalleryCollectionClassification: ExtensionClassification;
    }
  ).SaveToGalleryCollectionClassification;

beforeAll(async () => {
  await import("../extension/collection-classification.js");
});

describe("collection-derived asset classification", () => {
  test("maps typed collection names and the Stills alias to canonical tags", () => {
    expect(assetTypeTagForCollectionName("Characters")).toBe("character");
    expect(assetTypeTagForCollectionName("Locations")).toBe("location");
    expect(assetTypeTagForCollectionName("Scenes")).toBe("scene");
    expect(assetTypeTagForCollectionName("Stills")).toBe("scene");
    expect(assetTypeTagForCollectionName("Inspirations")).toBeNull();
    expect(assetTypeTagForCollectionName("Dear Annete")).toBeNull();
  });

  test("infers one type but refuses conflicting typed destinations", () => {
    expect(resolveImpliedAssetTypeTag(["Characters", "Characters"])).toBe(
      "character",
    );
    expect(resolveImpliedAssetTypeTag(["Characters", "Locations"])).toBeNull();
  });

  test("a typed destination replaces competing type aliases only", () => {
    expect(
      applyImpliedAssetTypeTag(
        ["location", "characters", "live-action", "cinematic"],
        "character",
      ),
    ).toEqual(["live-action", "cinematic", "character"]);
  });

  test("the extension uses the same collection rule", () => {
    const api = extensionApi();
    expect(
      api.resolveFolderAssetTypeTag("child-1", [
        { _id: "child-1", name: "Characters" },
      ]),
    ).toBe("character");
    expect(
      api.applyImpliedAssetTypeTag(
        ["location", "animation", "warm light"],
        "character",
      ),
    ).toEqual(["animation", "warm light", "character"]);
  });
});
