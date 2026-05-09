import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveAssetThumbUrl, resolveAssetUrl } from "../convex/r2_url";

const ORIGINAL_BASE = process.env.R2_PUBLIC_BASE_URL;

const buildStorageStub = (urlByStorageId: Record<string, string>) => ({
  storage: {
    getUrl: async (storageId: string) => urlByStorageId[storageId] ?? null,
  },
});

beforeEach(() => {
  process.env.R2_PUBLIC_BASE_URL = "https://pub-test.r2.dev";
});

afterEach(() => {
  if (ORIGINAL_BASE === undefined) {
    delete process.env.R2_PUBLIC_BASE_URL;
  } else {
    process.env.R2_PUBLIC_BASE_URL = ORIGINAL_BASE;
  }
});

describe("resolveAssetUrl fallback chain", () => {
  test("r2Key wins when present even with storageId and sourceUrl set", async () => {
    const ctx = buildStorageStub({ stor1: "https://convex/stor1" });
    const url = await resolveAssetUrl(ctx, {
      r2Key: "videos/abc.mp4",
      storageId: "stor1",
      sourceUrl: "https://example.com/upstream.mp4",
    });
    expect(url).toBe("https://pub-test.r2.dev/videos/abc.mp4");
  });

  test("trailing slashes are normalized in the public base", async () => {
    process.env.R2_PUBLIC_BASE_URL = "https://pub-test.r2.dev/";
    const ctx = buildStorageStub({});
    const url = await resolveAssetUrl(ctx, { r2Key: "videos/abc.mp4" });
    expect(url).toBe("https://pub-test.r2.dev/videos/abc.mp4");
  });

  test("falls back to storageId when r2Key absent", async () => {
    const ctx = buildStorageStub({ stor2: "https://convex/stor2" });
    const url = await resolveAssetUrl(ctx, {
      storageId: "stor2",
      sourceUrl: "https://example.com/upstream.mp4",
    });
    expect(url).toBe("https://convex/stor2");
  });

  test("falls back to sourceUrl when r2Key and storageId absent", async () => {
    const ctx = buildStorageStub({});
    const url = await resolveAssetUrl(ctx, {
      sourceUrl: "https://example.com/upstream.mp4",
    });
    expect(url).toBe("https://example.com/upstream.mp4");
  });

  test("returns undefined when nothing resolves", async () => {
    const ctx = buildStorageStub({});
    const url = await resolveAssetUrl(ctx, {});
    expect(url).toBeUndefined();
  });

  test("falls back past r2Key when R2_PUBLIC_BASE_URL is unset", async () => {
    delete process.env.R2_PUBLIC_BASE_URL;
    const ctx = buildStorageStub({ stor3: "https://convex/stor3" });
    const url = await resolveAssetUrl(ctx, {
      r2Key: "videos/abc.mp4",
      storageId: "stor3",
    });
    expect(url).toBe("https://convex/stor3");
  });

  test("falls back past storageId when getUrl returns null", async () => {
    const ctx = buildStorageStub({}); // stor4 not present → null
    const url = await resolveAssetUrl(ctx, {
      storageId: "stor4",
      sourceUrl: "https://example.com/fallback.mp4",
    });
    expect(url).toBe("https://example.com/fallback.mp4");
  });

  test("resolves thumbnail-specific R2 URL before the primary asset URL", async () => {
    const ctx = buildStorageStub({});
    const url = await resolveAssetThumbUrl(ctx, {
      r2Key: "images/full.png",
      thumbR2Key: "images/full.thumb.jpg",
    });
    expect(url).toBe("https://pub-test.r2.dev/images/full.thumb.jpg");
  });

  test("falls back to primary R2 URL when no thumbnail exists", async () => {
    const ctx = buildStorageStub({});
    const url = await resolveAssetThumbUrl(ctx, {
      r2Key: "images/full.png",
    });
    expect(url).toBe("https://pub-test.r2.dev/images/full.png");
  });
});
