import { describe, expect, test } from "bun:test";

import { isCardThumbSharp, needsCardThumb } from "../lib/card-thumbnail";
import { buildGalleryEntries } from "../lib/gallery-entries";

describe("card thumbnail rules", () => {
  test("a portrait thumb counts by its height", () => {
    expect(isCardThumbSharp({ width: 1080, thumbWidth: 576, thumbHeight: 1024 })).toBe(true);
    expect(isCardThumbSharp({ width: 1080, thumbWidth: 540, thumbHeight: 960 })).toBe(true);
  });

  test("a thumb that carries every original pixel is sharp at any size", () => {
    expect(isCardThumbSharp({ width: 579, thumbWidth: 579, thumbHeight: 400 })).toBe(true);
  });

  test("a small thumb of a large original is soft", () => {
    expect(isCardThumbSharp({ width: 1280, thumbWidth: 640, thumbHeight: 360 })).toBe(false);
    expect(isCardThumbSharp({ width: 1280 })).toBe(false);
  });

  test("missing, soft, and pre-encoder thumbs need rebuilding", () => {
    expect(needsCardThumb({ width: 2048 }, undefined)).toBe(true);
    expect(
      needsCardThumb({ width: 2048, thumbR2Key: "k", thumbWidth: 400, thumbHeight: 300 }, "image/webp"),
    ).toBe(true);
    // The old quality-100 JPEG and PNG thumbs.
    expect(
      needsCardThumb({ width: 2048, thumbR2Key: "k", thumbWidth: 1024, thumbHeight: 1024 }, "image/jpeg"),
    ).toBe(true);
    expect(
      needsCardThumb({ width: 928, thumbR2Key: "k", thumbWidth: 928, thumbHeight: 1232 }, "image/png"),
    ).toBe(true);
  });

  test("a sharp WebP card thumb is left alone", () => {
    expect(
      needsCardThumb({ width: 2944, thumbR2Key: "k", thumbWidth: 1440, thumbHeight: 806 }, "image/webp"),
    ).toBe(false);
  });
});

describe("gallery tile source", () => {
  const tileSrc = (asset: Record<string, unknown>) =>
    buildGalleryEntries({
      assets: [
        {
          _id: "asset:1",
          url: "https://example.com/original.png",
          thumbUrl: "https://example.com/thumb.webp",
          createdAt: 1,
          ...asset,
        },
      ],
      sortOrder: "newest",
    })[0]?.src;

  test("a portrait image tile shows its thumb, not the original", () => {
    expect(tileSrc({ kind: "image", width: 1792, height: 2688, thumbWidth: 640, thumbHeight: 960 })).toBe(
      "https://example.com/thumb.webp",
    );
  });

  test("a soft thumb gives way to the original", () => {
    expect(tileSrc({ kind: "image", width: 2048, height: 1152, thumbWidth: 400, thumbHeight: 225 })).toBe(
      "https://example.com/original.png",
    );
  });
});
