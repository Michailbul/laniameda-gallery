import { describe, expect, test } from "bun:test";

import { buildGridImageAttrs, GRID_IMAGE_SIZES, GRID_VIDEO_SIZES, gridImageSizes } from "../lib/grid-image";
import { buildGalleryEntries } from "../lib/gallery-entries";

const thumb = "https://r2.example/thumbs/a.webp";
const full = "https://r2.example/a.png";

describe("grid image srcset", () => {
  test("lists the thumb and the original at their real widths, smallest first", () => {
    const attrs = buildGridImageAttrs(
      { src: thumb, thumbSrc: thumb, thumbWidth: 1440, fullSrc: full, fullWidth: 2048 },
      362,
    );
    expect(attrs.src).toBe(thumb);
    expect(attrs.srcSet).toBe(`${thumb} 1440w, ${full} 2048w`);
    expect(attrs.sizes).toBe("362px");
  });

  test("a soft thumb still goes in the srcset: the browser picks by the tile's width", () => {
    const attrs = buildGridImageAttrs(
      { src: full, thumbSrc: thumb, thumbWidth: 640, fullSrc: full, fullWidth: 1280 },
      300,
    );
    expect(attrs.src).toBe(full);
    expect(attrs.srcSet).toBe(`${thumb} 640w, ${full} 1280w`);
  });

  test("no srcset without two distinct renditions of known width", () => {
    expect(buildGridImageAttrs({ src: full, fullSrc: full, fullWidth: 1280 }).srcSet).toBeUndefined();
    expect(buildGridImageAttrs({ src: full, thumbSrc: full, thumbWidth: 1280, fullSrc: full, fullWidth: 1280 }).srcSet).toBeUndefined();
    expect(buildGridImageAttrs({ src: thumb, thumbSrc: thumb, fullSrc: full, fullWidth: 1280 }).srcSet).toBeUndefined();
    expect(buildGridImageAttrs({ src: thumb, thumbSrc: thumb, thumbWidth: 0, fullSrc: full, fullWidth: 1280 }).srcSet).toBeUndefined();
  });

  test("sizes is the laid-out tile width when known, else the breakpoint estimate", () => {
    expect(gridImageSizes(417.6)).toBe("418px");
    expect(gridImageSizes(undefined)).toBe(GRID_IMAGE_SIZES);
    expect(gridImageSizes(undefined, "video")).toBe(GRID_VIDEO_SIZES);
    expect(gridImageSizes(Number.NaN)).toBe(GRID_IMAGE_SIZES);
  });

  test("gallery entries carry the two renditions for the tile", () => {
    const [entry] = buildGalleryEntries({
      sortOrder: "newest",
      assets: [
        {
          _id: "a1",
          kind: "image",
          url: full,
          thumbUrl: thumb,
          width: 2048,
          height: 1365,
          thumbWidth: 1440,
          thumbHeight: 960,
          createdAt: 1,
        },
      ],
    });
    expect(entry).toMatchObject({ src: thumb, fullSrc: full, thumbSrc: thumb, thumbWidth: 1440, fullWidth: 2048 });
    expect(entry.previewImages[0]).toMatchObject({ thumbSrc: thumb, thumbWidth: 1440, fullWidth: 2048 });
  });
});
