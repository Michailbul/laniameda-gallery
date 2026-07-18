import { describe, expect, test } from "bun:test";
import {
  buildIngestKey,
  buildMidjourneyIngestKeyPrefixes,
  parseTagNames,
} from "../lib/ingest";

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

describe("buildMidjourneyIngestKeyPrefixes", () => {
  const jobId = "60815ee1-104c-4daa-a5d0-f342821edf92";

  test("derives boundary prefixes from a grid variant url", () => {
    expect(
      buildMidjourneyIngestKeyPrefixes(
        `https://cdn.midjourney.com/${jobId}/0_1_640_N.webp?method=shortest`,
      ),
    ).toEqual([
      `https://cdn.midjourney.com/${jobId}/0_1.`,
      `https://cdn.midjourney.com/${jobId}/0_1_`,
    ]);
  });

  test("derives the same prefixes from the full-res viewer url", () => {
    expect(
      buildMidjourneyIngestKeyPrefixes(
        `https://cdn.midjourney.com/${jobId}/0_1.jpeg`,
      ),
    ).toEqual([
      `https://cdn.midjourney.com/${jobId}/0_1.`,
      `https://cdn.midjourney.com/${jobId}/0_1_`,
    ]);
  });

  test("prefixes cannot match a different image index", () => {
    const [dotPrefix, underscorePrefix] = buildMidjourneyIngestKeyPrefixes(
      `https://cdn.midjourney.com/${jobId}/0_1.jpeg`,
    );
    const otherIndexKey = `https://cdn.midjourney.com/${jobId}/0_10_640_N.webp`;
    expect(otherIndexKey.startsWith(dotPrefix)).toBe(false);
    expect(otherIndexKey.startsWith(underscorePrefix)).toBe(false);
  });

  test("ignores non-midjourney and non-variant urls", () => {
    expect(
      buildMidjourneyIngestKeyPrefixes("https://example.com/a/0_1.jpeg"),
    ).toEqual([]);
    expect(
      buildMidjourneyIngestKeyPrefixes(
        `https://cdn.midjourney.com/${jobId}/grid_0.webp`,
      ),
    ).toEqual([]);
    expect(buildMidjourneyIngestKeyPrefixes("not a url")).toEqual([]);
    expect(buildMidjourneyIngestKeyPrefixes(undefined)).toEqual([]);
  });
});
