import { afterEach, expect, test } from "bun:test";
import sharp from "sharp";
import { streamAssetDownload } from "../lib/server/asset-download";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const stubUpstream = (body: Uint8Array, contentType: string) => {
  globalThis.fetch = (async () =>
    new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(body.byteLength),
      },
    })) as typeof fetch;
};

const solidImage = (format: "webp" | "jpeg" | "png") =>
  sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 200, g: 90, b: 80 },
    },
  })
    .toFormat(format)
    .toBuffer();

const fileNameOf = (response: Response) =>
  /filename="([^"]+)"/.exec(
    response.headers.get("content-disposition") ?? "",
  )?.[1];

test("a stored WebP downloads as a JPEG", async () => {
  const webp = await solidImage("webp");
  stubUpstream(new Uint8Array(webp), "image/webp");

  const response = await streamAssetDownload(
    {
      url: "https://media.example.com/piece.webp",
      fileName: "midjourney-shot.webp",
      contentType: "image/webp",
      kind: "image",
    },
    "assets_abcdefgh",
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(fileNameOf(response)).toBe("midjourney-shot.jpg");

  const bytes = Buffer.from(await response.arrayBuffer());
  expect((await sharp(bytes).metadata()).format).toBe("jpeg");
});

test("a stored JPEG streams through untouched", async () => {
  const jpeg = await solidImage("jpeg");
  stubUpstream(new Uint8Array(jpeg), "image/jpeg");

  const response = await streamAssetDownload(
    {
      url: "https://media.example.com/piece.jpg",
      fileName: "keeper.jpg",
      contentType: "image/jpeg",
      kind: "image",
    },
    "assets_abcdefgh",
  );

  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(fileNameOf(response)).toBe("keeper.jpg");
  expect(Buffer.from(await response.arrayBuffer()).equals(jpeg)).toBe(true);
});

test("video streams as-is", async () => {
  const clip = new Uint8Array([0, 1, 2, 3, 4]);
  stubUpstream(clip, "video/mp4");

  const response = await streamAssetDownload(
    {
      url: "https://media.example.com/clip.mp4",
      contentType: "video/mp4",
      kind: "video",
    },
    "assets_abcdefgh",
  );

  expect(response.headers.get("content-type")).toBe("video/mp4");
  // No stored file name — the fallback carries the content type's extension.
  expect(fileNameOf(response)).toBe("laniameda-abcdefgh.mp4");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(clip);
});

test("an undecodable image falls back to the original bytes", async () => {
  const garbage = new Uint8Array([1, 2, 3, 4, 5, 6]);
  stubUpstream(garbage, "image/webp");

  const response = await streamAssetDownload(
    {
      url: "https://media.example.com/broken.webp",
      fileName: "broken.webp",
      contentType: "image/webp",
      kind: "image",
    },
    "assets_abcdefgh",
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(fileNameOf(response)).toBe("broken.webp");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(garbage);
});
