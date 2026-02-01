import { describe, expect, test } from "bun:test";
import { buildIngestKey, parseTagNames } from "../lib/ingest";

describe("parseTagNames", () => {
  test("splits comma-separated tags", () => {
    expect(parseTagNames("neon, portrait,  cyberpunk ")).toEqual([
      "neon",
      "portrait",
      "cyberpunk",
    ]);
  });

  test("dedupes tags", () => {
    expect(parseTagNames(["neon", "neon", "portrait"])).toEqual([
      "neon",
      "portrait",
    ]);
  });
});

describe("buildIngestKey", () => {
  test("prefers explicit key", () => {
    expect(
      buildIngestKey({
        ingestKey: "custom",
        url: "https://example.com",
        promptText: "test",
      }),
    ).toBe("custom");
  });

  test("creates key from url, file, and prompt", () => {
    expect(
      buildIngestKey({
        url: "https://example.com/file.png",
        fileName: "file.png",
        promptText: "neon portrait",
      }),
    ).toBe("https://example.com/file.png|file.png|neon portrait");
  });
});
