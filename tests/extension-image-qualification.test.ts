import { beforeAll, describe, expect, test } from "bun:test";

type ImageQualificationApi = {
  isQualifiedImageElement: (
    img: unknown,
    options?: {
      badgeAttr?: string;
      getImageUrl?: (img: unknown) => string;
    },
  ) => boolean;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryImageQualification: ImageQualificationApi;
  }).SaveToGalleryImageQualification;

beforeAll(async () => {
  await import("../extension/image-qualification.js");
});

const createImage = ({
  src = "https://cdn.example.com/reference.png",
  naturalWidth = 1200,
  naturalHeight = 800,
  width = naturalWidth,
  height = naturalHeight,
  clientWidth = width,
  clientHeight = height,
  offsetWidth = width,
  offsetHeight = height,
  rectWidth = width,
  rectHeight = height,
  hasBadge = false,
}: {
  src?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
  clientWidth?: number;
  clientHeight?: number;
  offsetWidth?: number;
  offsetHeight?: number;
  rectWidth?: number;
  rectHeight?: number;
  hasBadge?: boolean;
} = {}) => ({
  src,
  currentSrc: src,
  naturalWidth,
  naturalHeight,
  width,
  height,
  clientWidth,
  clientHeight,
  offsetWidth,
  offsetHeight,
  hasAttribute: (name: string) => hasBadge && name === "data-stg-badge",
  getBoundingClientRect: () => ({ width: rectWidth, height: rectHeight }),
});

describe("Save to Gallery image qualification", () => {
  test("accepts large images with large rendered size", () => {
    const api = getApi();
    const img = createImage({
      naturalWidth: 1600,
      naturalHeight: 1200,
      rectWidth: 320,
      rectHeight: 240,
    });

    expect(
      api.isQualifiedImageElement(img, {
        badgeAttr: "data-stg-badge",
        getImageUrl: (node: { src: string }) => node.src,
      }),
    ).toBe(true);
  });

  test("rejects tiny rendered icons even when the source image is large", () => {
    const api = getApi();
    const img = createImage({
      naturalWidth: 1024,
      naturalHeight: 1024,
      width: 24,
      height: 24,
      clientWidth: 24,
      clientHeight: 24,
      offsetWidth: 24,
      offsetHeight: 24,
      rectWidth: 24,
      rectHeight: 24,
    });

    expect(
      api.isQualifiedImageElement(img, {
        badgeAttr: "data-stg-badge",
        getImageUrl: (node: { src: string }) => node.src,
      }),
    ).toBe(false);
  });

  test("rejects small source assets even when they render larger", () => {
    const api = getApi();
    const img = createImage({
      naturalWidth: 64,
      naturalHeight: 64,
      rectWidth: 200,
      rectHeight: 200,
    });

    expect(
      api.isQualifiedImageElement(img, {
        badgeAttr: "data-stg-badge",
        getImageUrl: (node: { src: string }) => node.src,
      }),
    ).toBe(false);
  });
});
