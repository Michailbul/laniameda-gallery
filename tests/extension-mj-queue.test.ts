import { beforeAll, describe, expect, test } from "bun:test";

type Ref = { url?: string; code?: string; assetId?: string; weight?: number; label?: string };
type QueueApi = {
  nextQueued: (items: { id: string; status: string }[], afterId?: string | null) => { id: string } | null;
  jobIdsIn: (values: string[]) => Set<string>;
  promptNeedle: (item: { prompt: string }) => string;
  parseRefLines: (text: string, previous?: Ref[]) => Ref[];
  refLines: (refs: Ref[]) => string;
  threadName: (batch: Batch) => string;
  threadGroups: (batches: Batch[], scope?: string) => { label: string; left: number; threads: (Batch & { name: string; left: number; done: boolean })[] }[];
  threadOrder: (batches: Batch[], scope?: string) => string[];
  filterItems: (items: { id: string; status: string }[], filter: string, activeId?: string | null) => { id: string }[];
  filterCounts: (items: { id: string; status: string }[]) => Record<string, number>;
  recount: (batches: Batch[], items: { batchKey: string; status: string }[]) => Batch[];
};
type Batch = { batch: string; batchKey: string; worldKey?: string; total: number; queued: number; injected: number; sent: number; skipped: number; updatedAt: number };
const batch = (name: string, worldKey: string | undefined, counts: Partial<Batch>, updatedAt: number): Batch => ({
  batch: name, batchKey: name.toLowerCase(), worldKey, total: 0, queued: 0, injected: 0, sent: 0, skipped: 0, updatedAt, ...counts,
});
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

  test("a thread drops its world prefix under that world's group", () => {
    expect(api().threadName(batch("Dear Annete · the monster's hand · round 2", "dear-annete", {}, 1))).toBe("the monster's hand · round 2");
    expect(api().threadName(batch("Night lettering", "dear-annete", {}, 1))).toBe("Night lettering");
  });

  test("threads group by world; open ones first, newest first; finished ones fold away", () => {
    const batches = [
      batch("Dear Annete · old done", "dear-annete", { total: 3, sent: 3 }, 50),
      batch("Dear Annete · airship", "dear-annete", { total: 8, queued: 8 }, 10),
      batch("Dear Annete · hand", "dear-annete", { total: 8, queued: 5, injected: 1, sent: 2 }, 40),
      batch("Andromeda · kitchen", "andromeda", { total: 2, queued: 2 }, 99),
    ];
    const groups = api().threadGroups(batches, "all");
    expect(groups.map((group) => group.label)).toEqual(["DEAR ANNETE", "ANDROMEDA"]);
    expect(groups[0].threads.map((thread) => thread.name)).toEqual(["hand", "airship", "old done"]);
    expect(groups[0].left).toBe(14);
    expect(api().threadGroups(batches, "open")[0].threads.map((thread) => thread.name)).toEqual(["hand", "airship"]);
    expect(api().threadOrder(batches, "open")).toEqual(["dear annete · hand", "dear annete · airship", "andromeda · kitchen"]);
  });

  test("filters keep the prompt in the bar in view and count each status", () => {
    const items = [
      { id: "a", status: "sent" }, { id: "b", status: "queued" }, { id: "c", status: "skipped" }, { id: "d", status: "injected" },
    ];
    expect(api().filterItems(items, "open").map((item) => item.id)).toEqual(["b", "d"]);
    expect(api().filterItems(items, "sent", "d").map((item) => item.id)).toEqual(["a", "d"]);
    expect(api().filterItems(items, "all").length).toBe(4);
    expect(api().filterCounts(items)).toEqual({ open: 2, sent: 1, skipped: 1, all: 4 });
  });

  test("thread counts follow the items on hand", () => {
    const batches = [batch("Hand", "dear-annete", { total: 2, queued: 2 }, 1), batch("Empty", "dear-annete", { total: 1, sent: 1 }, 1)];
    const items = [{ batchKey: "hand", status: "sent" }, { batchKey: "hand", status: "injected" }];
    const [hand, empty] = api().recount(batches, items);
    expect([hand.total, hand.queued, hand.injected, hand.sent, hand.skipped]).toEqual([2, 0, 1, 1, 0]);
    expect(empty.sent).toBe(1);
  });
});
