import { beforeAll, describe, expect, test } from "bun:test";

type ShotdeckAdapterApi = {
  extractDescription: (el: unknown, doc?: unknown) => string;
  getBestSrcFromSrcset: (srcset: string) => string;
  getMediaUrl: (el: unknown) => string;
  getTagNames: () => string[];
  isQualifiedMediaElement: (
    el: unknown,
    options?: { badgeAttr?: string },
  ) => boolean;
  isSaveableMediaUrl: (url: string) => boolean;
  isShotdeckPage: (hostname?: string) => boolean;
  looksLikeDescription: (value: string) => boolean;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryShotdeck: ShotdeckAdapterApi;
  }).SaveToGalleryShotdeck;

beforeAll(async () => {
  await import("../extension/shotdeck-adapter.js");
});

const createImage = ({
  src = "https://shotdeck.com/assets/images/stills/abcdef123456.jpg",
  srcset = "",
  dataSrc = "",
  width = 300,
  height = 128,
  naturalWidth = 1920,
  naturalHeight = 816,
  hasBadge = false,
  alt = "",
} = {}) => ({
  tagName: "IMG",
  src,
  currentSrc: src,
  srcset,
  naturalWidth,
  naturalHeight,
  width,
  height,
  clientWidth: width,
  clientHeight: height,
  offsetWidth: width,
  offsetHeight: height,
  parentElement: null,
  hasAttribute: (name: string) =>
    hasBadge && name === "data-stg-mj-media-badge",
  getAttribute: (name: string) => {
    if (name === "alt" && alt) return alt;
    if (name === "data-src" && dataSrc) return dataSrc;
    return null;
  },
  getBoundingClientRect: () => ({ width, height }),
});

describe("ShotDeck extension adapter", () => {
  test("matches shotdeck.com hosts only", () => {
    const api = getApi();
    expect(api.isShotdeckPage("shotdeck.com")).toBe(true);
    expect(api.isShotdeckPage("www.shotdeck.com")).toBe(true);
    expect(api.isShotdeckPage("pinterest.com")).toBe(false);
    expect(api.isShotdeckPage("notshotdeck.com")).toBe(false);
    expect(api.isShotdeckPage("shotdeck.com.evil.io")).toBe(false);
  });

  test("prefers the largest srcset candidate for media url", () => {
    const api = getApi();
    const srcset = [
      "https://shotdeck.com/assets/images/stills/a_small.jpg 480w",
      "https://shotdeck.com/assets/images/stills/a_large.jpg 1920w",
    ].join(", ");
    expect(api.getBestSrcFromSrcset(srcset)).toBe(
      "https://shotdeck.com/assets/images/stills/a_large.jpg",
    );
  });

  test("falls back to data-src when src is a lazy-load placeholder", () => {
    const api = getApi();
    const img = createImage({
      src: "data:image/gif;base64,R0lGOD",
      dataSrc: "https://shotdeck.com/assets/images/stills/real.jpg",
    });
    expect(api.getMediaUrl(img)).toBe(
      "https://shotdeck.com/assets/images/stills/real.jpg",
    );
  });

  test("accepts still urls and rejects svg and UI chrome paths", () => {
    const api = getApi();
    expect(
      api.isSaveableMediaUrl(
        "https://shotdeck.com/assets/images/stills/abc.jpg",
      ),
    ).toBe(true);
    expect(api.isSaveableMediaUrl("https://cdn.shotdeck.com/still.webp")).toBe(
      true,
    );
    expect(api.isSaveableMediaUrl("https://shotdeck.com/logo.svg")).toBe(false);
    expect(
      api.isSaveableMediaUrl("https://shotdeck.com/assets/site-logo.png"),
    ).toBe(false);
    expect(
      api.isSaveableMediaUrl("https://shotdeck.com/user-avatar.jpg"),
    ).toBe(false);
  });

  test("qualifies wide film stills despite short rendered height", () => {
    const api = getApi();
    // 2.35:1 still rendered 300px wide is only ~128px tall.
    expect(api.isQualifiedMediaElement(createImage())).toBe(true);
    expect(
      api.isQualifiedMediaElement(createImage({ width: 240, height: 100 })),
    ).toBe(true);
  });

  test("rejects badged, tiny, and low-res elements", () => {
    const api = getApi();
    expect(
      api.isQualifiedMediaElement(createImage({ hasBadge: true }), {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(false);
    expect(
      api.isQualifiedMediaElement(createImage({ width: 60, height: 40 })),
    ).toBe(false);
    expect(
      api.isQualifiedMediaElement(
        createImage({ naturalWidth: 120, naturalHeight: 90 }),
      ),
    ).toBe(false);
  });

  test("reads the shot description from alt text, skipping UI labels", () => {
    const api = getApi();
    expect(api.looksLikeDescription("still")).toBe(false);
    expect(api.looksLikeDescription("shotdeck")).toBe(false);
    expect(api.looksLikeDescription("Blade Runner 2049")).toBe(true);
    const img = createImage({ alt: "Blade Runner 2049" });
    expect(api.extractDescription(img)).toBe("Blade Runner 2049");
    expect(api.extractDescription(createImage({ alt: "still" }))).toBe("");
  });

  test("tags saves with shotdeck", () => {
    const api = getApi();
    expect(api.getTagNames()).toEqual(["shotdeck"]);
  });
});
