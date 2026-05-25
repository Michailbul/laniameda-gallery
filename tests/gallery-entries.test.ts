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

  test("uses original video dimensions before thumbnail dimensions", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:video",
          kind: "video",
          thumbUrl: "https://example.com/video-poster.jpg",
          url: "https://example.com/video.mp4",
          width: 1080,
          height: 1920,
          thumbWidth: 720,
          thumbHeight: 720,
          promptText: "Vertical video",
          createdAt: 100,
        },
      ],
      sortOrder: "newest",
    });

    expect(entries[0]?.width).toBe(1080);
    expect(entries[0]?.height).toBe(1920);
    expect(entries[0]?.previewImages[0]?.width).toBe(1080);
    expect(entries[0]?.previewImages[0]?.height).toBe(1920);
  });

  test("keeps thumbnail dimensions first for images", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:image",
          kind: "image",
          thumbUrl: "https://example.com/image-thumb.jpg",
          url: "https://example.com/image.jpg",
          width: 2048,
          height: 1536,
          thumbWidth: 512,
          thumbHeight: 384,
          promptText: "Image",
          createdAt: 100,
        },
      ],
      sortOrder: "newest",
    });

    expect(entries[0]?.width).toBe(512);
    expect(entries[0]?.height).toBe(384);
  });

  test("uses landscape fallback for videos with only square dimensions", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:legacy-video",
          kind: "video",
          thumbUrl: "https://example.com/legacy-video-poster.jpg",
          url: "https://example.com/legacy-video.mp4",
          width: 720,
          height: 720,
          thumbWidth: 720,
          thumbHeight: 720,
          promptText: "Legacy square metadata video",
          createdAt: 100,
        },
      ],
      sortOrder: "newest",
    });

    expect(entries[0]?.width).toBe(16);
    expect(entries[0]?.height).toBe(9);
  });
});
