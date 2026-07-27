import { beforeAll, describe, expect, test } from "bun:test";

type HiggsfieldAdapterApi = {
  extractInputImagesFromValue: (
    value: unknown,
  ) => Array<{ url: string; role: string }>;
  extractPrompt: (el: unknown, doc?: unknown) => string;
  findVideoUrlInValue: (value: unknown) => string;
  getMediaUrl: (el: unknown) => string;
  getSaveContext: (el: unknown, doc?: unknown) => Record<string, unknown> | null;
  isHiggsfieldPage: (hostname?: string) => boolean;
  isQualifiedMediaElement: (
    el: unknown,
    options?: { badgeAttr?: string },
  ) => boolean;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryHiggsfield: HiggsfieldAdapterApi;
  }).SaveToGalleryHiggsfield;

beforeAll(async () => {
  await import("../extension/higgsfield-adapter.js");
});

const createVideo = ({
  src = "https://assets.higgsfield.ai/generations/couple.mp4",
  width = 640,
  height = 360,
  hasBadge = false,
  reactProps,
}: {
  src?: string;
  width?: number;
  height?: number;
  hasBadge?: boolean;
  reactProps?: unknown;
} = {}) => ({
  tagName: "VIDEO",
  currentSrc: src,
  src,
  videoWidth: 1920,
  videoHeight: 816,
  clientWidth: width,
  clientHeight: height,
  offsetWidth: width,
  offsetHeight: height,
  parentElement: null,
  querySelector: () => null,
  getAttribute: () => null,
  hasAttribute: (name: string) =>
    hasBadge && name === "data-stg-mj-media-badge",
  getBoundingClientRect: () => ({ width, height }),
  ...(reactProps ? { "__reactProps$higgsfield": reactProps } : {}),
});

describe("Higgsfield extension adapter", () => {
  test("matches Higgsfield hosts only", () => {
    const api = getApi();
    expect(api.isHiggsfieldPage("higgsfield.ai")).toBe(true);
    expect(api.isHiggsfieldPage("app.higgsfield.ai")).toBe(true);
    expect(api.isHiggsfieldPage("higgsfield.ai.evil.com")).toBe(false);
  });

  test("qualifies rendered generation videos and rejects tiny previews", () => {
    const api = getApi();
    expect(api.isQualifiedMediaElement(createVideo())).toBe(true);
    expect(
      api.isQualifiedMediaElement(createVideo({ width: 120, height: 68 })),
    ).toBe(false);
    expect(
      api.isQualifiedMediaElement(createVideo({ hasBadge: true }), {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(false);
  });

  test("extracts the full prompt from Higgsfield generation props", () => {
    const api = getApi();
    const prompt =
      "SCENE CONTEXT\nAn intimate couple slowly dances together in a dim interior for 8 seconds, their bodies close and their faces almost touching.\n\nCAMERA\nA slow push toward their faces.";
    const video = createVideo({
      reactProps: { job: { prompt, status: "completed" } },
    });

    expect(api.extractPrompt(video)).toBe(prompt);
  });

  test("recovers the CDN output URL when the video element uses a blob URL", () => {
    const api = getApi();
    const video = createVideo({
      src: "blob:https://higgsfield.ai/local-player",
      reactProps: {
        generation: {
          outputUrl:
            "https://assets.higgsfield.ai/generations/render-final.mp4?token=abc",
        },
      },
    });

    expect(api.getMediaUrl(video)).toBe(
      "https://assets.higgsfield.ai/generations/render-final.mp4?token=abc",
    );
  });

  test("extracts start, end, and reference images from job data", () => {
    const api = getApi();
    expect(
      api.extractInputImagesFromValue({
        promptVideo: "A slow dance in warm window light",
        medias: [
          {
            role: "start_image",
            data: { url: "https://assets.higgsfield.ai/input/start.webp" },
          },
          {
            role: "end_image",
            data: { url: "https://assets.higgsfield.ai/input/end.webp" },
          },
        ],
        inputImages: [
          { url: "https://assets.higgsfield.ai/input/reference.webp" },
        ],
      }),
    ).toEqual([
      {
        url: "https://assets.higgsfield.ai/input/start.webp",
        role: "start_image",
      },
      {
        url: "https://assets.higgsfield.ai/input/end.webp",
        role: "end_image",
      },
      {
        url: "https://assets.higgsfield.ai/input/reference.webp",
        role: "inputimages",
      },
    ]);
  });

  test("builds a video save context with prompt and references", () => {
    const api = getApi();
    const video = createVideo({
      reactProps: {
        generation: {
          prompt: "Two people dance slowly in a cinematic teal and amber room",
          startImageMedia: {
            url: "https://assets.higgsfield.ai/input/start.webp",
          },
        },
      },
    });

    expect(api.getMediaUrl(video)).toBe(
      "https://assets.higgsfield.ai/generations/couple.mp4",
    );
    expect(api.getSaveContext(video)).toMatchObject({
      promptText:
        "Two people dance slowly in a cinematic teal and amber room",
      mediaType: "video",
      modelName: "Higgsfield",
      tagNames: ["higgsfield", "higgsfield-video"],
      inputImages: [
        {
          url: "https://assets.higgsfield.ai/input/start.webp",
          role: "startimagemedia",
        },
      ],
    });
  });
});
