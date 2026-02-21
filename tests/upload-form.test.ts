import { describe, expect, test } from "bun:test";

import { buildIngestKey } from "@/lib/ingest";
import { buildUploadFormData } from "@/lib/upload-form";

describe("buildUploadFormData", () => {
  test("packs prompt, url, folder, tags, and file into a FormData payload", () => {
    const file = new File(["data"], "image.png", { type: "image/png" });
    const formData = buildUploadFormData({
      promptText: "Test prompt",
      url: "https://example.com/image.png",
      folderId: " folder-1 ",
      tags: ["sunset", "sunset", "dream"],
      file,
    });

    expect(formData.get("prompt")).toBe("Test prompt");
    expect(formData.get("url")).toBe("https://example.com/image.png");
    expect(formData.get("folderId")).toBe("folder-1");
    expect(formData.getAll("tags")).toEqual(["sunset", "dream"]);
    expect(formData.get("ingestKey")).toBe(
      buildIngestKey({
        promptText: "Test prompt",
        url: "https://example.com/image.png",
        fileName: "image.png",
      })!,
    );
    expect(formData.get("promptIngestKey")).toBe(buildIngestKey({ promptText: "Test prompt" })!);
    const fileEntry = formData.get("file");
    expect(fileEntry).toBeInstanceOf(File);
    expect((fileEntry as File).name).toBe("image.png");
  });

  test("supports url-only submissions and skips undefined values", () => {
    const formData = buildUploadFormData({
      promptText: "",
      url: " https://example.com/image.png ",
      tags: ["  one  ", "two"],
    });

    expect(formData.get("prompt")).toBeNull();
    expect(formData.get("url")).toBe("https://example.com/image.png");
    expect(formData.get("folderId")).toBeNull();
    expect(formData.getAll("tags")).toEqual(["one", "two"]);
  });
});
