import { describe, expect, test } from "bun:test";

import {
  MAX_BULK_FILES,
  formatBytes,
  isZipFile,
  resolveMedia,
  stageBulkFiles,
} from "@/lib/bulk-upload";

const raw = (name: string, type = "", size = 8, path?: string) => ({
  file: new File([new Uint8Array(size)], name, { type }),
  relativePath: path,
});

describe("resolveMedia", () => {
  test("trusts a declared content type", () => {
    expect(resolveMedia("shot.bin", "image/png")).toEqual({
      kind: "image",
      contentType: "image/png",
    });
    expect(resolveMedia("clip.bin", "video/mp4")).toEqual({
      kind: "video",
      contentType: "video/mp4",
    });
  });

  test("falls back to the extension for untyped zip entries", () => {
    expect(resolveMedia("shot_01.PNG")).toEqual({
      kind: "image",
      contentType: "image/png",
    });
    expect(resolveMedia("beat.mov")).toEqual({
      kind: "video",
      contentType: "video/quicktime",
    });
  });

  test("rejects anything that is not media", () => {
    expect(resolveMedia("notes.txt")).toBeNull();
    expect(resolveMedia("prompt.json", "application/json")).toBeNull();
    expect(resolveMedia("noextension")).toBeNull();
  });
});

describe("isZipFile", () => {
  test("matches by extension or content type", () => {
    expect(isZipFile(new File([], "renders.zip"))).toBe(true);
    expect(isZipFile(new File([], "renders", { type: "application/zip" }))).toBe(true);
    expect(isZipFile(new File([], "render.png", { type: "image/png" }))).toBe(false);
  });
});

describe("stageBulkFiles", () => {
  test("keeps media, drops the rest, and reports the count", async () => {
    const result = await stageBulkFiles([
      raw("a.png", "image/png"),
      raw("notes.txt", "text/plain"),
      raw("b.mp4", "video/mp4"),
    ]);

    expect(result.added.map((item) => item.relativePath)).toEqual(["a.png", "b.mp4"]);
    expect(result.added.map((item) => item.kind)).toEqual(["image", "video"]);
    expect(result.skipped).toBe(1);
    expect(result.overflow).toBe(0);
  });

  test("sorts the way a render folder reads", async () => {
    const result = await stageBulkFiles([
      raw("shot_10.png", "image/png"),
      raw("shot_2.png", "image/png"),
      raw("shot_1.png", "image/png"),
    ]);

    expect(result.added.map((item) => item.relativePath)).toEqual([
      "shot_1.png",
      "shot_2.png",
      "shot_10.png",
    ]);
  });

  test("ignores macOS resource forks and dotfiles", async () => {
    const result = await stageBulkFiles([
      raw("a.png", "image/png", 8, "drop/__MACOSX/._a.png"),
      raw("b.png", "image/png", 8, "drop/.DS_Store.png"),
      raw("c.png", "image/png", 8, "drop/c.png"),
    ]);

    expect(result.added.map((item) => item.relativePath)).toEqual(["drop/c.png"]);
    expect(result.skipped).toBe(2);
  });

  test("de-dupes against an existing batch by path and size", async () => {
    const first = await stageBulkFiles([raw("a.png", "image/png", 8, "drop/a.png")]);
    const second = await stageBulkFiles(
      [
        raw("a.png", "image/png", 8, "drop/a.png"),
        raw("a.png", "image/png", 9, "drop/a.png"),
        raw("a.png", "image/png", 8, "other/a.png"),
      ],
      first.added,
    );

    expect(second.added.map((item) => item.id)).toEqual([
      "drop/a.png:9",
      "other/a.png:8",
    ]);
    expect(second.duplicates).toBe(1);
    expect(second.skipped).toBe(0);
  });

  test("caps the batch and reports the overflow", async () => {
    const inputs = Array.from({ length: MAX_BULK_FILES + 5 }, (_, index) =>
      raw(`shot_${index}.png`, "image/png"),
    );
    const result = await stageBulkFiles(inputs);

    expect(result.added).toHaveLength(MAX_BULK_FILES);
    expect(result.overflow).toBe(5);
  });

  test("re-wraps untyped files so the ingest branches correctly", async () => {
    const result = await stageBulkFiles([raw("clip.mov")]);

    expect(result.added[0].file.type).toBe("video/quicktime");
    expect(result.added[0].kind).toBe("video");
  });
});

describe("formatBytes", () => {
  test("reads at a human scale", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
    expect(formatBytes(120 * 1024 * 1024)).toBe("120 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});
