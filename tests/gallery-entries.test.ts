import { describe, expect, test } from "bun:test";

import { buildGalleryEntries } from "../lib/gallery-entries";

describe("gallery entry builder", () => {
  test("groups explicit pack members into one cover entry", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:older",
          assetPackId: "pack:1",
          packSlotIndex: 1,
          promptId: "prompt:1",
          sourceUrl: "https://example.com/older.jpg",
          promptText: "Older shot",
          createdAt: 100,
        },
        {
          _id: "asset:cover",
          assetPackId: "pack:1",
          packSlotIndex: 0,
          promptId: "prompt:1",
          sourceUrl: "https://example.com/cover.jpg",
          promptText: "Cover shot",
          createdAt: 200,
        },
      ],
      sortOrder: "newest",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("asset:cover");
    expect(entries[0]?.packId).toBe("pack:1");
    expect(entries[0]?.packMemberCount).toBe(2);
    expect(entries[0]?.previewImages.map((image) => image.id)).toEqual([
      "asset:cover",
      "asset:older",
    ]);
  });

  test("falls back to prompt grouping before explicit pack backfill runs", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:a",
          promptId: "prompt:shared",
          sourceUrl: "https://example.com/a.jpg",
          promptText: "Variant A",
          createdAt: 300,
        },
        {
          _id: "asset:b",
          promptId: "prompt:shared",
          sourceUrl: "https://example.com/b.jpg",
          promptText: "Variant B",
          createdAt: 250,
        },
        {
          _id: "asset:c",
          sourceUrl: "https://example.com/c.jpg",
          promptText: "Standalone",
          createdAt: 100,
        },
      ],
      sortOrder: "newest",
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).toBe("asset:a");
    expect(entries[0]?.packMemberCount).toBe(2);
    expect(entries[1]?.id).toBe("asset:c");
  });
});
