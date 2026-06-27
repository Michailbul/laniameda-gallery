import { beforeAll, describe, expect, test } from "bun:test";

type MidjourneyAdapterApi = {
  extractUrlsFromCssImage: (value: string) => string[];
  findJobObject: (el: unknown) => unknown;
  getBestSrcFromSrcset: (srcset: string) => string;
  getMediaUrl: (el: unknown) => string;
  isQualifiedMediaElement: (
    el: unknown,
    options?: { badgeAttr?: string },
  ) => boolean;
  isLikedGenerationElement: (el: unknown) => boolean;
  reconstructPrompt: (job: unknown) => string | null;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryMidjourney: MidjourneyAdapterApi;
  }).SaveToGalleryMidjourney;

beforeAll(async () => {
  await import("../extension/midjourney-adapter.js");
});

const createImage = ({
  src = "https://cdn.midjourney.com/job/0_1_384_N.webp",
  srcset = "https://cdn.midjourney.com/job/0_1_384_N.webp 384w, https://cdn.midjourney.com/job/0_1_640_N.webp 640w",
  width = 320,
  height = 320,
  hasBadge = false,
} = {}) => ({
  tagName: "IMG",
  src,
  currentSrc: src,
  srcset,
  naturalWidth: 640,
  naturalHeight: 640,
  width,
  height,
  clientWidth: width,
  clientHeight: height,
  offsetWidth: width,
  offsetHeight: height,
  hasAttribute: (name: string) => hasBadge && name === "data-stg-mj-media-badge",
  getBoundingClientRect: () => ({ width, height }),
});

describe("Midjourney extension adapter", () => {
  test("selects the largest srcset candidate", () => {
    const api = getApi();

    expect(
      api.getBestSrcFromSrcset(
        "https://cdn.midjourney.com/job/0_1_384_N.webp 384w, https://cdn.midjourney.com/job/0_1_640_N.webp 640w",
      ),
    ).toBe("https://cdn.midjourney.com/job/0_1_640_N.webp");
  });

  test("extracts css image urls and prefers the final image-set candidate", () => {
    const api = getApi();
    const css =
      'image-set(url("https://cdn.midjourney.com/job/0_1_384_N.webp") 1x, url("https://cdn.midjourney.com/job/0_1_1024_N.webp") 2x)';

    expect(api.extractUrlsFromCssImage(css)).toEqual([
      "https://cdn.midjourney.com/job/0_1_384_N.webp",
      "https://cdn.midjourney.com/job/0_1_1024_N.webp",
    ]);
  });

  test("qualifies visible Midjourney img elements", () => {
    const api = getApi();
    const img = createImage();

    expect(
      api.isQualifiedMediaElement(img, {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(true);
    expect(api.getMediaUrl(img)).toBe(
      "https://cdn.midjourney.com/job/0_1_640_N.webp",
    );
  });

  test("rejects already-badged or tiny Midjourney images", () => {
    const api = getApi();

    expect(
      api.isQualifiedMediaElement(createImage({ hasBadge: true }), {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(false);
    expect(api.isQualifiedMediaElement(createImage({ width: 48, height: 48 }))).toBe(false);
  });

  test("finds a React job object and reconstructs prompt flags", () => {
    const api = getApi();
    const el = {
      parentElement: null,
      "__reactFiber$test": {
        memoizedProps: {
          job: {
            prompt: {
              decodedPrompt: [
                { content: "cinematic portrait", weight: 1 },
                { content: "peach studio light", weight: 1.25 },
              ],
              ar: { w: 2, h: 3 },
              stylize: 150,
              version: "6.1",
            },
          },
        },
      },
    };

    const job = api.findJobObject(el);
    expect(api.reconstructPrompt(job)).toBe(
      "cinematic portrait peach studio light::1.25 --ar 2:3 --stylize 150 --v 6.1",
    );
  });

  test("detects liked generations from Midjourney like controls", () => {
    const api = getApi();
    const likedCard = {
      querySelectorAll: () => [
        {
          textContent: "",
          getAttribute: (name: string) => name === "title" ? "Unlike Image (L)" : "",
        },
      ],
    };
    const unlikedCard = {
      querySelectorAll: () => [
        {
          textContent: "",
          getAttribute: (name: string) => name === "title" ? "Like Image (L)" : "",
        },
      ],
    };

    expect(api.isLikedGenerationElement(likedCard)).toBe(true);
    expect(api.isLikedGenerationElement(unlikedCard)).toBe(false);
  });

  test("falls back to React job liked state", () => {
    const api = getApi();
    const el = {
      parentElement: null,
      querySelectorAll: () => [],
      "__reactFiber$test": {
        memoizedProps: {
          job: {
            prompt: { decodedPrompt: "portrait" },
            isLiked: true,
          },
        },
      },
    };

    expect(api.isLikedGenerationElement(el)).toBe(true);
  });
});
