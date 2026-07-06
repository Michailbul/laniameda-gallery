import { beforeAll, describe, expect, test } from "bun:test";

type KreaAdapterApi = {
  extractPrompt: (el: unknown, doc?: unknown) => string;
  getMediaUrl: (el: unknown) => string;
  getTagNames: (pathname?: string) => string[];
  isKreaPage: (hostname?: string) => boolean;
  isQualifiedMediaElement: (
    el: unknown,
    options?: { badgeAttr?: string },
  ) => boolean;
  isSaveableMediaUrl: (url: string) => boolean;
  looksLikePromptText: (value: string) => boolean;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryKrea: KreaAdapterApi;
  }).SaveToGalleryKrea;

beforeAll(async () => {
  await import("../extension/krea-adapter.js");
});

const createImage = ({
  src = "https://s3.us-east-1.amazonaws.com/prod.generations.krea.ai/abc123.webp",
  srcset = "",
  width = 512,
  height = 512,
  naturalWidth = 1024,
  naturalHeight = 1024,
  hasBadge = false,
  alt = "",
  parentElement = null as unknown,
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
  parentElement,
  hasAttribute: (name: string) =>
    hasBadge && name === "data-stg-mj-media-badge",
  getAttribute: (name: string) => (name === "alt" && alt ? alt : null),
  getBoundingClientRect: () => ({ width, height }),
});

describe("Krea extension adapter", () => {
  test("matches krea.ai hosts only", () => {
    const api = getApi();
    expect(api.isKreaPage("www.krea.ai")).toBe(true);
    expect(api.isKreaPage("krea.ai")).toBe(true);
    expect(api.isKreaPage("app.krea.ai")).toBe(true);
    expect(api.isKreaPage("midjourney.com")).toBe(false);
    expect(api.isKreaPage("notkrea.ai")).toBe(false);
    expect(api.isKreaPage("krea.ai.evil.com")).toBe(false);
  });

  test("prefers the largest srcset candidate for media url", () => {
    const api = getApi();
    const img = createImage({
      srcset:
        "https://cdn.krea.ai/gen/small.webp 384w, https://cdn.krea.ai/gen/large.webp 1024w",
    });
    expect(api.getMediaUrl(img)).toBe("https://cdn.krea.ai/gen/large.webp");
  });

  test("accepts https/blob/raster-data urls and rejects svg/spacers", () => {
    const api = getApi();
    expect(api.isSaveableMediaUrl("https://cdn.krea.ai/gen/a.webp")).toBe(true);
    expect(api.isSaveableMediaUrl("blob:https://www.krea.ai/uuid")).toBe(true);
    expect(api.isSaveableMediaUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(api.isSaveableMediaUrl("data:image/svg+xml,<svg/>")).toBe(false);
    expect(api.isSaveableMediaUrl("https://krea.ai/logo.svg")).toBe(false);
    expect(api.isSaveableMediaUrl("https://a.com/spacer.gif")).toBe(false);
    expect(api.isSaveableMediaUrl("")).toBe(false);
  });

  test("qualifies large rendered generations and rejects small UI chrome", () => {
    const api = getApi();
    expect(api.isQualifiedMediaElement(createImage())).toBe(true);
    // Style-preset thumb: rendered too small.
    expect(
      api.isQualifiedMediaElement(createImage({ width: 96, height: 96 })),
    ).toBe(false);
    // Avatar: intrinsically too small.
    expect(
      api.isQualifiedMediaElement(
        createImage({ naturalWidth: 128, naturalHeight: 128 }),
      ),
    ).toBe(false);
    // Already badged.
    expect(
      api.isQualifiedMediaElement(createImage({ hasBadge: true }), {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(false);
  });

  test("qualifies videos before intrinsic metadata is known", () => {
    const api = getApi();
    const video = {
      tagName: "VIDEO",
      currentSrc: "https://cdn.krea.ai/gen/clip.mp4",
      src: "https://cdn.krea.ai/gen/clip.mp4",
      poster: "",
      videoWidth: 0,
      videoHeight: 0,
      clientWidth: 480,
      clientHeight: 270,
      offsetWidth: 480,
      offsetHeight: 270,
      hasAttribute: () => false,
      getBoundingClientRect: () => ({ width: 480, height: 270 }),
    };
    // Rendered 480x270 clears both 150px floors; intrinsic size unknown (0x0)
    // is tolerated for videos until metadata loads.
    expect(api.isQualifiedMediaElement(video)).toBe(true);
  });

  test("qualifies large background-image containers without nested media", () => {
    const api = getApi();
    const makeBgDiv = (hasNestedImg: boolean) => ({
      tagName: "DIV",
      style: {
        backgroundImage:
          'image-set(url("https://cdn.krea.ai/gen/small.webp") 1x, url("https://cdn.krea.ai/gen/large.webp") 2x)',
      },
      clientWidth: 400,
      clientHeight: 400,
      offsetWidth: 400,
      offsetHeight: 400,
      hasAttribute: () => false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ width: 400, height: 400 }),
      querySelector: () => (hasNestedImg ? {} : null),
    });

    expect(api.getMediaUrl(makeBgDiv(false))).toBe(
      "https://cdn.krea.ai/gen/large.webp",
    );
    expect(api.isQualifiedMediaElement(makeBgDiv(false))).toBe(true);
    // Wraps a real <img> — the inner element gets the widget instead.
    expect(api.isQualifiedMediaElement(makeBgDiv(true))).toBe(false);
  });

  test("filters non-prompt labels", () => {
    const api = getApi();
    expect(api.looksLikePromptText("generated image")).toBe(false);
    expect(api.looksLikePromptText("Krea")).toBe(false);
    expect(api.looksLikePromptText("https://krea.ai/thing")).toBe(false);
    expect(api.looksLikePromptText("output.png")).toBe(false);
    expect(
      api.looksLikePromptText(
        "cinematic portrait of a woman in neon rain, 85mm",
      ),
    ).toBe(true);
  });

  test("extracts prompt from alt text", () => {
    const api = getApi();
    const img = createImage({
      alt: "a brutalist concrete tower at golden hour, fog",
    });
    expect(api.extractPrompt(img)).toBe(
      "a brutalist concrete tower at golden hour, fog",
    );
  });

  test("extracts prompt from react-style props when present", () => {
    const api = getApi();
    const img = createImage() as Record<string, unknown>;
    img.__reactProps$abc = {
      generation: {
        prompt: "isometric diorama of a tokyo street at night",
      },
    };
    expect(api.extractPrompt(img)).toBe(
      "isometric diorama of a tokyo street at night",
    );
  });

  test("extracts prompt from ancestor data-prompt attributes", () => {
    const api = getApi();
    const card = {
      getAttribute: (name: string) =>
        name === "data-prompt"
          ? "watercolor fox in a snowy forest, soft light"
          : null,
      parentElement: null,
      querySelector: () => null,
    };
    const img = createImage({ parentElement: card });
    expect(api.extractPrompt(img)).toBe(
      "watercolor fox in a snowy forest, soft light",
    );
  });

  test("falls back to the workspace prompt input", () => {
    const api = getApi();
    const doc = {
      querySelectorAll: (selector: string) =>
        selector.includes("textarea")
          ? [
              {
                getAttribute: (name: string) =>
                  name === "placeholder" ? "Describe an image..." : null,
                id: "",
                value: "a lighthouse on a cliff, storm waves, dramatic sky",
                textContent: "",
              },
            ]
          : [],
    };
    const img = createImage();
    expect(api.extractPrompt(img, doc)).toBe(
      "a lighthouse on a cliff, storm waves, dramatic sky",
    );
  });

  test("tags saves by krea surface", () => {
    const api = getApi();
    expect(api.getTagNames("/image")).toEqual(["krea", "krea-image"]);
    expect(api.getTagNames("/video")).toEqual(["krea", "krea-video"]);
    expect(api.getTagNames("/realtime")).toEqual(["krea", "krea-realtime"]);
    expect(api.getTagNames("/")).toEqual(["krea"]);
  });
});
