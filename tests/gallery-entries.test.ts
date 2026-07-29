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

  test("floats starred assets to the top, newest star first", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:newest",
          sourceUrl: "https://example.com/newest.jpg",
          createdAt: 900,
        },
        {
          _id: "asset:old-star",
          sourceUrl: "https://example.com/old-star.jpg",
          createdAt: 100,
          starredAt: 500,
          starNote: "the reference for the whole world",
        },
        {
          _id: "asset:new-star",
          sourceUrl: "https://example.com/new-star.jpg",
          createdAt: 200,
          starredAt: 800,
        },
      ],
      sortOrder: "newest",
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "asset:new-star",
      "asset:old-star",
      "asset:newest",
    ]);
    expect(entries[1]?.starNote).toBe("the reference for the whole world");
  });

  test("keeps starred assets on top through a shuffle", () => {
    const entries = buildGalleryEntries({
      assets: Array.from({ length: 8 }, (_, index) => ({
        _id: `asset:${index}`,
        sourceUrl: `https://example.com/${index}.jpg`,
        createdAt: index,
        starredAt: index === 3 ? 999 : undefined,
      })),
      sortOrder: "shuffle",
      shuffleSeed: 7,
    });

    expect(entries).toHaveLength(8);
    expect(entries[0]?.id).toBe("asset:3");
  });

  test("leaves semantic score order alone when star promotion is off", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:best-match",
          sourceUrl: "https://example.com/best.jpg",
          createdAt: 100,
        },
        {
          _id: "asset:starred-but-weaker",
          sourceUrl: "https://example.com/weaker.jpg",
          createdAt: 50,
          starredAt: 999,
        },
      ],
      sortOrder: "shuffle",
      shuffleSeed: 1,
      promoteStarred: false,
    });

    expect(entries.map((entry) => entry.id)).toContain("asset:best-match");
    expect(entries.filter((entry) => entry.starredAt)).toHaveLength(1);
  });

  test("a starred pack member promotes the pack tile it renders as", () => {
    const entries = buildGalleryEntries({
      assets: [
        {
          _id: "asset:pack-cover",
          assetPackId: "pack:1",
          packSlotIndex: 0,
          sourceUrl: "https://example.com/cover.jpg",
          createdAt: 200,
        },
        {
          _id: "asset:pack-member",
          assetPackId: "pack:1",
          packSlotIndex: 1,
          sourceUrl: "https://example.com/member.jpg",
          createdAt: 100,
          starredAt: 700,
          starNote: "this frame is the one",
        },
        {
          _id: "asset:loose-newer",
          sourceUrl: "https://example.com/loose.jpg",
          createdAt: 5000,
        },
      ],
      sortOrder: "newest",
    });

    expect(entries[0]?.id).toBe("asset:pack-cover");
    expect(entries[0]?.starredAt).toBe(700);
    expect(entries[0]?.starNote).toBe("this frame is the one");
  });
});
