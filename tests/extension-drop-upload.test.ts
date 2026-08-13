import { beforeAll, describe, expect, test } from "bun:test";

type DropItem = { file: File; relativePath: string };
type DropUploadApi = {
  MAX_QUEUE_FILES: number;
  collectDroppedFiles: (
    dataTransfer: unknown,
    limit?: number,
  ) => Promise<{
    accepted: DropItem[];
    rejectedCount: number;
    truncatedCount: number;
  }>;
  formatBytes: (bytes: number) => string;
  inferContentType: (file: File) => string;
  isSupportedMediaFile: (file: File) => boolean;
  normalizePickedFiles: (
    files: File[],
    limit?: number,
  ) => {
    accepted: DropItem[];
    rejectedCount: number;
    truncatedCount: number;
  };
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryDropUpload: DropUploadApi;
  }).SaveToGalleryDropUpload;

beforeAll(async () => {
  await import("../extension/drop-upload.js");
});

describe("extension local drop helpers", () => {
  test("accepts image/video files and infers missing browser MIME types", () => {
    const api = getApi();
    const jpeg = new File([new Uint8Array([1])], "portrait.JPG");
    const movie = new File([new Uint8Array([2])], "scene.mov");
    const notes = new File(["hello"], "notes.txt", { type: "text/plain" });

    expect(api.inferContentType(jpeg)).toBe("image/jpeg");
    expect(api.inferContentType(movie)).toBe("video/quicktime");
    expect(api.isSupportedMediaFile(jpeg)).toBeTrue();
    expect(api.isSupportedMediaFile(movie)).toBeTrue();
    expect(api.isSupportedMediaFile(notes)).toBeFalse();
  });

  test("filters unsupported files, dedupes, and honors the queue limit", () => {
    const api = getApi();
    const first = new File([new Uint8Array([1])], "one.png", {
      type: "image/png",
      lastModified: 10,
    });
    const duplicate = new File([new Uint8Array([1])], "one.png", {
      type: "image/png",
      lastModified: 10,
    });
    const second = new File([new Uint8Array([2])], "two.mp4", {
      type: "video/mp4",
    });
    const unsupported = new File(["x"], "readme.md", { type: "text/markdown" });

    const result = api.normalizePickedFiles(
      [first, duplicate, unsupported, second],
      1,
    );

    expect(result.accepted.map((item) => item.file.name)).toEqual(["one.png"]);
    expect(result.rejectedCount).toBe(1);
    expect(result.truncatedCount).toBe(1);
  });

  test("walks every chunk of a dropped directory and preserves its path", async () => {
    const api = getApi();
    const image = new File([new Uint8Array([1])], "frame.webp", {
      type: "image/webp",
    });
    const ignored = new File(["x"], "prompt.txt", { type: "text/plain" });
    const fileEntry = (file: File) => ({
      isFile: true,
      isDirectory: false,
      name: file.name,
      file(resolve: (value: File) => void) {
        resolve(file);
      },
    });
    const batches = [[fileEntry(image)], [fileEntry(ignored)], []];
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: "references",
      createReader: () => ({
        readEntries(resolve: (value: unknown[]) => void) {
          resolve(batches.shift() || []);
        },
      }),
    };

    const result = await api.collectDroppedFiles({
      items: [{ webkitGetAsEntry: () => directoryEntry }],
      files: [],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.relativePath).toBe("references/frame.webp");
    expect(result.rejectedCount).toBe(1);
  });

  test("formats queue sizes for compact rows", () => {
    const api = getApi();
    expect(api.formatBytes(800)).toBe("800 B");
    expect(api.formatBytes(1536)).toBe("1.5 KB");
    expect(api.formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });
});
