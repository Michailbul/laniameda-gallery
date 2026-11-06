import { beforeAll, describe, expect, test } from "bun:test";

type Ref = { url?: string; code?: string; assetId?: string; weight?: number; label?: string };
type QueueApi = {
  nextQueued: (items: { id: string; status: string }[], afterId?: string | null) => { id: string } | null;
  jobIdsIn: (values: string[]) => Set<string>;
  promptNeedle: (item: { prompt: string }) => string;
  parseRefLines: (text: string, previous?: Ref[]) => Ref[];
  refLines: (refs: Ref[]) => string;
};
const api = () => (globalThis as typeof globalThis & { SaveToGalleryMjQueue: QueueApi }).SaveToGalleryMjQueue;

beforeAll(async () => {
  await import("../extension/mj-queue.js");
});

describe("extension Midjourney queue helpers", () => {
  test("next queued item follows the last one, then wraps to the top", () => {
    const items = [
      { id: "a", status: "sent" }, { id: "b", status: "queued" }, { id: "c", status: "skipped" }, { id: "d", status: "queued" },
    ];
    expect(api().nextQueued(items, "b")?.id).toBe("d");
    expect(api().nextQueued(items, "d")?.id).toBe("b");
    expect(api().nextQueued(items, null)?.id).toBe("b");
    expect(api().nextQueued([{ id: "a", status: "sent" }], null)).toBeNull();
  });

  test("job ids come out of job links and CDN image URLs", () => {
    const ids = api().jobIdsIn([
      "/jobs/0C1E5A2B-1111-4a4a-9b9b-123456789abc?index=0",
      "https://cdn.midjourney.com/7d3f0000-2222-4b4b-8c8c-abcdefabcdef/0_1_384_N.webp",
      "https://example.com/nothing",
    ]);
    expect([...ids]).toEqual(["0c1e5a2b-1111-4a4a-9b9b-123456789abc", "7d3f0000-2222-4b4b-8c8c-abcdefabcdef"]);
  });

  test("reference lines keep gallery asset ids and weights", () => {
    const previous = [{ url: "https://r2.test/fleur.jpg", assetId: "k123", label: "Fleur De Leah" }];
    expect(api().parseRefLines("https://r2.test/fleur.jpg::2\n3534013297\n\nhttps://x.test/new.png", previous)).toEqual([
      { assetId: "asset:k123", url: "https://r2.test/fleur.jpg", weight: 2, label: "Fleur De Leah" },
      { code: "3534013297" },
      { url: "https://x.test/new.png" },
    ]);
    expect(api().refLines([{ url: "https://r2.test/a.jpg", weight: 2 }, { code: "123" }])).toBe("https://r2.test/a.jpg::2\n123");
  });

  test("the prompt needle is its first five words", () => {
    expect(api().promptNeedle({ prompt: "  The NAME Annete written by hand, iron-gall" })).toBe("the name annete written by");
  });
});
