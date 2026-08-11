import { afterEach, describe, expect, test } from "bun:test";

import { quickIngestFile } from "@/lib/quick-ingest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const stubFetch = (
  response: { ok: boolean; body: unknown },
): { calls: { url: string; formData: FormData }[] } => {
  const calls: { url: string; formData: FormData }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      formData: init?.body as FormData,
    });
    return {
      ok: response.ok,
      json: async () => response.body,
    } as Response;
  }) as typeof fetch;
  return { calls };
};

const smallImage = () =>
  new File(["pixels"], "shot_01.png", { type: "image/png" });

const neverUploads = async () => {
  throw new Error("R2 upload should not run for a small image.");
};

describe("quickIngestFile", () => {
  test("sends the destination folder, the type tag, and the bytes", async () => {
    const { calls } = stubFetch({
      ok: true,
      body: { result: { assetId: "asset-1" } },
    });

    const result = await quickIngestFile({
      file: smallImage(),
      folderId: "folder-9",
      tags: ["character"],
      uploadToR2: neverUploads,
    });

    expect(result).toEqual({ assetId: "asset-1", duplicate: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/ingest");
    const formData = calls[0]!.formData;
    expect(formData.get("folderId")).toBe("folder-9");
    expect(formData.getAll("tags")).toEqual(["character"]);
    expect(formData.get("generationType")).toBe("image_gen");
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(formData.get("r2Key")).toBeNull();
  });

  test("drops the ingestKey so dedupe runs on content, not file name", async () => {
    const { calls } = stubFetch({
      ok: true,
      body: { result: { assetId: "asset-1" } },
    });

    await quickIngestFile({
      file: smallImage(),
      tags: ["scene"],
      uploadToR2: neverUploads,
    });

    // Two unrelated "shot_01.png" drops must not collapse onto one asset —
    // and an ingestKey hit would also swallow the new type tag.
    expect(calls[0]!.formData.get("ingestKey")).toBeNull();
    expect(calls[0]!.formData.get("promptIngestKey")).toBeNull();
  });

  test("reports a content-hash twin as a duplicate", async () => {
    stubFetch({
      ok: true,
      body: { result: { assetId: "asset-7", duplicateMedia: true } },
    });

    const result = await quickIngestFile({
      file: smallImage(),
      folderId: "folder-9",
      tags: ["location"],
      uploadToR2: neverUploads,
    });

    expect(result).toEqual({ assetId: "asset-7", duplicate: true });
  });

  test("surfaces the ingest error message", async () => {
    stubFetch({ ok: false, body: { error: "Folder not found." } });

    await expect(
      quickIngestFile({
        file: smallImage(),
        tags: ["character"],
        uploadToR2: neverUploads,
      }),
    ).rejects.toThrow("Folder not found.");
  });

  test("refuses anything that isn't image or video", async () => {
    stubFetch({ ok: true, body: { result: { assetId: "asset-1" } } });

    await expect(
      quickIngestFile({
        file: new File(["notes"], "brief.pdf", { type: "application/pdf" }),
        tags: ["scene"],
        uploadToR2: neverUploads,
      }),
    ).rejects.toThrow("isn't an image or a video");
  });
});
