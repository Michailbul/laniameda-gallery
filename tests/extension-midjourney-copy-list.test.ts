import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Selection = { jobId: string; index: number };
type Entry = {
  key: string;
  jobId: string;
  index: number;
  url: string;
  previewUrl?: string;
  addedAt: number;
  prompt?: string;
  personalization?: { code: string; type: string; name?: string }[];
};
type Storage = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
};
type Store = {
  read: () => Promise<Entry[]>;
  add: (entry: Entry) => Promise<Entry[]>;
  addDetails: (key: string, details: Partial<Entry>) => Promise<Entry[]>;
  remove: (key: string) => Promise<Entry[]>;
  clear: () => Promise<Entry[]>;
};
type CopyListApi = {
  STORAGE_KEY: string;
  buildEntry: (selection: Selection, options?: { previewUrl?: string; addedAt?: number }) => Entry | null;
  createStore: (storage: Storage) => Store;
  detailsFromMetadata: (collected: unknown) => Partial<Entry>;
  formatList: (list: Partial<Entry>[]) => string;
};

const getApi = () =>
  (globalThis as typeof globalThis & { SaveToGalleryMidjourneyCopyList: CopyListApi })
    .SaveToGalleryMidjourneyCopyList;

beforeAll(async () => {
  await import("../extension/midjourney-copy-list.js");
});

const JOB_A = "11111111-2222-3333-4444-555555555555";
const JOB_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const entry = (jobId: string, index: number) => {
  const built = getApi().buildEntry({ jobId, index }, { addedAt: 1 });
  if (!built) throw new Error("entry did not build");
  return built;
};

// Yields on every call, so writes that are not queued really do overwrite.
const memoryStorage = () => {
  const data: Record<string, unknown> = {};
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  return {
    data,
    get: async (key: string) => {
      await tick();
      return key in data ? { [key]: data[key] } : {};
    },
    set: async (values: Record<string, unknown>) => {
      await tick();
      Object.assign(data, values);
    },
  };
};

describe("buildEntry", () => {
  test("the link is the job URL with the tile index", () => {
    expect(entry(JOB_A, 2).url).toBe(`https://www.midjourney.com/jobs/${JOB_A}?index=2`);
  });

  test("tile 0 keeps its index", () => {
    expect(entry(JOB_A, 0).url).toBe(`https://www.midjourney.com/jobs/${JOB_A}?index=0`);
  });

  test("two tiles of one job are two entries", () => {
    expect(entry(JOB_A, 0).key).not.toBe(entry(JOB_A, 1).key);
  });

  test("refuses anything that is not a job and a tile", () => {
    const { buildEntry } = getApi();
    expect(buildEntry({ jobId: "not-a-job", index: 0 })).toBeNull();
    expect(buildEntry({ jobId: JOB_A, index: -1 })).toBeNull();
    expect(buildEntry({ jobId: JOB_A, index: 1.5 })).toBeNull();
  });
});

describe("detailsFromMetadata", () => {
  test("keeps the prompt and the codes", () => {
    expect(
      getApi().detailsFromMetadata({
        promptText: " a quiet street --p abc ",
        metadata: {
          jobId: JOB_A,
          stylize: 100,
          personalization: [
            { code: "abc", type: "moodboard", name: "DA DECO", id: "9" },
            { code: "def", type: "profile" },
            { code: "ghi", type: "unknown" },
          ],
        },
      }),
    ).toEqual({
      prompt: "a quiet street --p abc",
      personalization: [
        { code: "abc", type: "moodboard", name: "DA DECO" },
        { code: "def", type: "profile" },
        { code: "ghi", type: "unknown" },
      ],
    });
  });

  test("nothing read means nothing to add", () => {
    expect(getApi().detailsFromMetadata(null)).toEqual({});
    expect(
      getApi().detailsFromMetadata({ promptText: "", metadata: { personalization: [] } }),
    ).toEqual({});
  });
});

describe("formatList", () => {
  test("a bare link still copies", () => {
    expect(getApi().formatList([entry(JOB_A, 2)])).toBe(
      `Midjourney copy list: 1 image\n\n1. https://www.midjourney.com/jobs/${JOB_A}?index=2`,
    );
  });

  test("prompt, moodboard and profile sit beside their own link, in order", () => {
    const text = getApi().formatList([
      {
        ...entry(JOB_A, 2),
        prompt: "a quiet\nstreet  --p abc def",
        personalization: [
          { code: "abc", type: "moodboard", name: "DA DECO" },
          { code: "def", type: "profile" },
          { code: "ghi", type: "unknown" },
        ],
      },
      entry(JOB_B, 0),
    ]);

    expect(text).toBe(
      [
        "Midjourney copy list: 2 images",
        "",
        `1. https://www.midjourney.com/jobs/${JOB_A}?index=2`,
        "   Prompt: a quiet street --p abc def",
        "   Moodboard: abc (DA DECO)",
        "   Profile: def",
        "   Code: ghi",
        "",
        `2. https://www.midjourney.com/jobs/${JOB_B}?index=0`,
      ].join("\n"),
    );
  });

  test("an empty list copies nothing", () => {
    expect(getApi().formatList([])).toBe("");
  });
});

describe("createStore", () => {
  test("adds at the same moment from several tabs all land, in order", async () => {
    const store = getApi().createStore(memoryStorage());
    await Promise.all([0, 1, 2, 3, 4, 5].map((index) => store.add(entry(JOB_A, index))));
    expect((await store.read()).map((item) => item.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("adding what is there keeps its place and its details", async () => {
    const store = getApi().createStore(memoryStorage());
    await store.add(entry(JOB_A, 0));
    await store.add(entry(JOB_B, 0));
    await store.addDetails(entry(JOB_A, 0).key, { prompt: "a street" });
    await store.add(entry(JOB_A, 0));
    const list = await store.read();
    expect(list.map((item) => item.jobId)).toEqual([JOB_A, JOB_B]);
    expect(list[0].prompt).toBe("a street");
  });

  test("details arriving after a remove do not bring the entry back", async () => {
    const store = getApi().createStore(memoryStorage());
    await store.add(entry(JOB_A, 0));
    await Promise.all([
      store.remove(entry(JOB_A, 0).key),
      store.addDetails(entry(JOB_A, 0).key, { prompt: "late" }),
    ]);
    expect(await store.read()).toEqual([]);
  });

  test("the list stays through a new worker: only clear empties it", async () => {
    const storage = memoryStorage();
    await getApi().createStore(storage).add(entry(JOB_A, 0));

    const nextWorker = getApi().createStore(storage);
    expect(await nextWorker.read()).toHaveLength(1);

    await nextWorker.remove(entry(JOB_B, 0).key);
    expect(await nextWorker.read()).toHaveLength(1);

    await nextWorker.clear();
    expect(await nextWorker.read()).toEqual([]);
  });

  test("a failed write is reported and does not block the next one", async () => {
    const storage = memoryStorage();
    const realSet = storage.set;
    storage.set = async () => {
      throw new Error("QUOTA_BYTES quota exceeded");
    };
    const store = getApi().createStore(storage);
    await expect(store.add(entry(JOB_A, 0))).rejects.toThrow("QUOTA_BYTES");

    storage.set = realSet;
    await store.add(entry(JOB_B, 0));
    expect((await store.read()).map((item) => item.jobId)).toEqual([JOB_B]);
  });
});

describe("wiring", () => {
  const read = (path: string) =>
    readFileSync(new URL(`../extension/${path}`, import.meta.url), "utf8");

  test("loads in the page, in the worker and on re-injection, ahead of content.js", () => {
    const manifest = JSON.parse(read("manifest.json"));
    const pageScripts: string[] = manifest.content_scripts[0].js;
    expect(pageScripts.indexOf("midjourney-copy-list.js")).toBeGreaterThanOrEqual(0);
    expect(pageScripts.indexOf("midjourney-copy-list.js")).toBeLessThan(
      pageScripts.indexOf("content.js"),
    );

    const worker = read("background.js");
    const [imports, reinjected] = [
      worker.match(/importScripts\(([\s\S]*?)\);/)?.[1] ?? "",
      worker.match(/CONTENT_SCRIPT_JS_FILES = \[([\s\S]*?)\]/)?.[1] ?? "",
    ];
    expect(imports).toContain("midjourney-copy-list.js");
    expect(reinjected).toContain("midjourney-copy-list.js");
  });

  // The two are separate actions. The copy list must never reach a save.
  test("the copy list code path sends no save message", () => {
    const content = read("content.js");
    const start = content.indexOf("// ── Midjourney copy list ──");
    const end = content.indexOf("function createMidjourneyMediaWidget");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = content.slice(start, end);
    expect(block).not.toMatch(/action:\s*"save/i);
    expect(block).not.toContain("handleSaveMidjourneyMedia");
    expect(block).not.toContain("withMidjourneyMetadata");
  });
});
