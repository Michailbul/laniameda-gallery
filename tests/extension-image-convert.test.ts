import { afterEach, beforeAll, describe, expect, test } from "bun:test";

type ImageConvertApi = {
  shouldConvertToJpeg: (contentType?: string) => boolean;
  shouldConvertToPng: (contentType?: string) => boolean;
  hasPngSignature: (blob: Blob) => Promise<boolean>;
  convertCapturedBlob: (
    blob: Blob,
    contentType?: string,
    preferredContentType?: string,
  ) => Promise<{ blob: Blob; contentType: string; converted: boolean }>;
  base64FromBlob: (blob: Blob) => Promise<string>;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryImageConvert: ImageConvertApi;
  }).SaveToGalleryImageConvert;

beforeAll(async () => {
  await import("../extension/image-convert.js");
});

// The extension runs in a browser; bun has neither of these. Stub only what a
// given test needs and clear it afterwards.
type Stubbed = typeof globalThis & {
  createImageBitmap?: unknown;
  OffscreenCanvas?: unknown;
};

const stubCanvasPipeline = (encodedBytes: Uint8Array) => {
  const scope = globalThis as Stubbed;
  scope.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
  scope.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { fillStyle: "", fillRect() {}, drawImage() {} };
    }
    async convertToBlob({ type }: { type: string }) {
      return new Blob([encodedBytes], { type });
    }
  };
};

afterEach(() => {
  const scope = globalThis as Stubbed;
  delete scope.createImageBitmap;
  delete scope.OffscreenCanvas;
});

describe("shouldConvertToJpeg", () => {
  test("WebP and friends convert; JPEG, PNG, GIF and video do not", () => {
    const { shouldConvertToJpeg } = getApi();

    expect(shouldConvertToJpeg("image/webp")).toBe(true);
    expect(shouldConvertToJpeg("IMAGE/WEBP; charset=binary")).toBe(true);
    expect(shouldConvertToJpeg("image/avif")).toBe(true);

    expect(shouldConvertToJpeg("image/jpeg")).toBe(false);
    // PNG keeps its alpha channel, GIF keeps its animation.
    expect(shouldConvertToJpeg("image/png")).toBe(false);
    expect(shouldConvertToJpeg("image/gif")).toBe(false);
    expect(shouldConvertToJpeg("video/mp4")).toBe(false);
    expect(shouldConvertToJpeg(undefined)).toBe(false);
  });
});

describe("shouldConvertToPng", () => {
  test("converts browser raster formats but leaves PNG and non-raster media alone", () => {
    const { shouldConvertToPng } = getApi();

    expect(shouldConvertToPng("image/webp")).toBe(true);
    expect(shouldConvertToPng("image/jpeg")).toBe(true);
    expect(shouldConvertToPng("image/avif")).toBe(true);

    expect(shouldConvertToPng("image/png")).toBe(false);
    expect(shouldConvertToPng("image/gif")).toBe(false);
    expect(shouldConvertToPng("image/svg+xml")).toBe(false);
    expect(shouldConvertToPng("video/mp4")).toBe(false);
  });
});

describe("hasPngSignature", () => {
  test("accepts real PNG bytes and rejects a WebP labeled as PNG", async () => {
    const { hasPngSignature } = getApi();
    const png = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    ], { type: "image/png" });
    const mislabeledWebp = new Blob([
      new TextEncoder().encode("RIFF1234WEBP"),
    ], { type: "image/png" });

    expect(await hasPngSignature(png)).toBe(true);
    expect(await hasPngSignature(mislabeledWebp)).toBe(false);
  });
});

describe("convertCapturedBlob", () => {
  test("re-encodes a WebP capture to JPEG", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);
    stubCanvasPipeline(jpegBytes);

    const result = await getApi().convertCapturedBlob(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
      "image/webp",
    );

    expect(result.converted).toBe(true);
    expect(result.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(jpegBytes);
  });

  test("re-encodes Midjourney WebP and JPEG captures to PNG", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    stubCanvasPipeline(pngBytes);

    for (const contentType of ["image/webp", "image/jpeg"]) {
      const result = await getApi().convertCapturedBlob(
        new Blob([new Uint8Array([1, 2, 3])], { type: contentType }),
        contentType,
        "image/png",
      );

      expect(result.converted).toBe(true);
      expect(result.contentType).toBe("image/png");
      expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(pngBytes);
    }
  });

  test("leaves an existing Midjourney PNG capture untouched", async () => {
    const original = new Blob([new Uint8Array([7, 8, 9])], {
      type: "image/png",
    });

    const result = await getApi().convertCapturedBlob(
      original,
      "image/png",
      "image/png",
    );

    expect(result.converted).toBe(false);
    expect(result.contentType).toBe("image/png");
    expect(result.blob).toBe(original);
  });

  test("leaves a JPEG capture untouched", async () => {
    const original = new Blob([new Uint8Array([9, 9, 9])], {
      type: "image/jpeg",
    });

    const result = await getApi().convertCapturedBlob(original, "image/jpeg");

    expect(result.converted).toBe(false);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.blob).toBe(original);
  });

  test("falls back to the original bytes when the decoder fails", async () => {
    const scope = globalThis as Stubbed;
    scope.createImageBitmap = async () => {
      throw new Error("decode failed");
    };
    const original = new Blob([new Uint8Array([4, 5, 6])], {
      type: "image/webp",
    });

    const result = await getApi().convertCapturedBlob(original, "image/webp");

    // A failed conversion must never cost the save.
    expect(result.converted).toBe(false);
    expect(result.contentType).toBe("image/webp");
    expect(result.blob).toBe(original);
  });
});

test("base64FromBlob round-trips the bytes", async () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

  const base64 = await getApi().base64FromBlob(new Blob([bytes]));

  expect(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))).toEqual(bytes);
});
