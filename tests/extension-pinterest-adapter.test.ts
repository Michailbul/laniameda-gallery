import { beforeAll, describe, expect, test } from "bun:test";

type PinterestAdapterApi = {
  extractDescription: (el: unknown, doc?: unknown) => string;
  getBestSrcFromSrcset: (srcset: string) => string;
  getMediaUrl: (el: unknown) => string;
  getPinUrl: (el: unknown) => string;
  getTagNames: () => string[];
  isPinterestPage: (hostname?: string) => boolean;
  isQualifiedMediaElement: (
    el: unknown,
    options?: { badgeAttr?: string },
  ) => boolean;
  isSaveableMediaUrl: (url: string) => boolean;
  looksLikeDescription: (value: string) => boolean;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryPinterest: PinterestAdapterApi;
  }).SaveToGalleryPinterest;

beforeAll(async () => {
  await import("../extension/pinterest-adapter.js");
});

const createImage = ({
  src = "https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg",
  srcset = "",
  width = 236,
  height = 350,
  naturalWidth = 736,
  naturalHeight = 1104,
  hasBadge = false,
  alt = "",
  closestPinHref = "",
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
  getAttribute: (name: string) => (name === "alt" && alt ? alt : null),
  getBoundingClientRect: () => ({ width, height }),
  closest: (selector: string) =>
    selector.includes("/pin/") && closestPinHref
      ? { getAttribute: () => closestPinHref }
      : null,
});

describe("Pinterest extension adapter", () => {
  test("matches pinterest hosts including country domains only", () => {
    const api = getApi();
    expect(api.isPinterestPage("www.pinterest.com")).toBe(true);
    expect(api.isPinterestPage("pinterest.com")).toBe(true);
    expect(api.isPinterestPage("cz.pinterest.com")).toBe(true);
    expect(api.isPinterestPage("pinterest.de")).toBe(true);
    expect(api.isPinterestPage("pinterest.co.uk")).toBe(true);
    expect(api.isPinterestPage("pinterest.com.au")).toBe(true);
    expect(api.isPinterestPage("midjourney.com")).toBe(false);
    expect(api.isPinterestPage("notpinterest.com")).toBe(false);
    expect(api.isPinterestPage("pinterest.evil-domain.com")).toBe(false);
    expect(api.isPinterestPage("pinterest.com.evil.io")).toBe(false);
  });

  test("prefers the originals candidate in srcset over sized variants", () => {
    const api = getApi();
    const srcset = [
      "https://i.pinimg.com/236x/ab/cd/ef/pin.jpg 236w",
      "https://i.pinimg.com/originals/ab/cd/ef/pin.jpg 474w",
      "https://i.pinimg.com/736x/ab/cd/ef/pin.jpg 736w",
    ].join(", ");
    expect(api.getBestSrcFromSrcset(srcset)).toBe(
      "https://i.pinimg.com/originals/ab/cd/ef/pin.jpg",
    );
    const img = createImage({ srcset });
    expect(api.getMediaUrl(img)).toBe(
      "https://i.pinimg.com/originals/ab/cd/ef/pin.jpg",
    );
  });

  test("falls back to the largest sized variant when no originals offered", () => {
    const api = getApi();
    const srcset = [
      "https://i.pinimg.com/236x/ab/pin.jpg 236w",
      "https://i.pinimg.com/736x/ab/pin.jpg 736w",
    ].join(", ");
    expect(api.getBestSrcFromSrcset(srcset)).toBe(
      "https://i.pinimg.com/736x/ab/pin.jpg",
    );
  });

  test("video pins save the poster frame, never the HLS stream", () => {
    const api = getApi();
    const video = {
      tagName: "VIDEO",
      src: "blob:https://www.pinterest.com/uuid",
      currentSrc: "https://v.pinimg.com/videos/mc/hls/ab/cd.m3u8",
      poster: "https://i.pinimg.com/videos/thumbnails/originals/ab/cd.jpg",
    };
    expect(api.getMediaUrl(video)).toBe(
      "https://i.pinimg.com/videos/thumbnails/originals/ab/cd.jpg",
    );
  });

  test("accepts pinimg media and rejects avatars and other hosts", () => {
    const api = getApi();
    expect(
      api.isSaveableMediaUrl("https://i.pinimg.com/736x/ab/cd/pin.jpg"),
    ).toBe(true);
    expect(
      api.isSaveableMediaUrl("https://i.pinimg.com/originals/ab/cd/pin.png"),
    ).toBe(true);
    expect(
      api.isSaveableMediaUrl("https://i.pinimg.com/75x75_RS/ab/avatar.jpg"),
    ).toBe(false);
    expect(
      api.isSaveableMediaUrl("https://i.pinimg.com/140x140/ab/avatar.jpg"),
    ).toBe(false);
    expect(api.isSaveableMediaUrl("https://example.com/pin.jpg")).toBe(false);
    expect(api.isSaveableMediaUrl("blob:https://www.pinterest.com/x")).toBe(
      false,
    );
  });

  test("qualifies grid pins including short wide pins", () => {
    const api = getApi();
    expect(api.isQualifiedMediaElement(createImage())).toBe(true);
    // 16:9 pin rendered in the 236px grid — short but real.
    expect(
      api.isQualifiedMediaElement(createImage({ width: 236, height: 133 })),
    ).toBe(true);
  });

  test("rejects badged, tiny, and non-pinimg elements", () => {
    const api = getApi();
    expect(
      api.isQualifiedMediaElement(createImage({ hasBadge: true }), {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(false);
    expect(
      api.isQualifiedMediaElement(createImage({ width: 64, height: 64 })),
    ).toBe(false);
    expect(
      api.isQualifiedMediaElement(
        createImage({ naturalWidth: 120, naturalHeight: 120 }),
      ),
    ).toBe(false);
    expect(
      api.isQualifiedMediaElement(
        createImage({ src: "https://example.com/photo.jpg", srcset: "" }),
      ),
    ).toBe(false);
  });

  test("reads the pin description from alt text, skipping UI labels", () => {
    const api = getApi();
    expect(api.looksLikeDescription("Pin")).toBe(false);
    expect(api.looksLikeDescription("pinterest")).toBe(false);
    expect(api.looksLikeDescription("moody cyberpunk alley at night")).toBe(
      true,
    );
    const img = createImage({ alt: "moody cyberpunk alley at night" });
    expect(api.extractDescription(img)).toBe("moody cyberpunk alley at night");
    const junk = createImage({ alt: "Pin" });
    expect(api.extractDescription(junk)).toBe("");
  });

  test("resolves the pin permalink from the closest pin link", () => {
    const api = getApi();
    const img = createImage({
      closestPinHref: "https://www.pinterest.com/pin/123456789/",
    });
    expect(api.getPinUrl(img)).toBe("https://www.pinterest.com/pin/123456789/");
    expect(api.getPinUrl(createImage())).toBe("");
  });

  test("tags saves with pinterest", () => {
    const api = getApi();
    expect(api.getTagNames()).toEqual(["pinterest"]);
  });
});
