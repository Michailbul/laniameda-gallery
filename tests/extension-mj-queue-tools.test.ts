import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
const Q = () => (globalThis as unknown as { SaveToGalleryMjQueue: any }).SaveToGalleryMjQueue;
const C = () => (globalThis as unknown as { SaveToGalleryMjQueueCompose: any }).SaveToGalleryMjQueueCompose;
const R = () => (globalThis as unknown as { SaveToGalleryRandomize: any }).SaveToGalleryRandomize;

beforeAll(async () => {
  await import("../extension/mj-randomize.js");
  await import("../extension/mj-queue-compose.js");
  await import("../extension/mj-queue.js");
});

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("thread params", () => {
  test("read, set and remove one flag, aliases included", () => {
    expect(Q().paramOf("--ar 3:1 --c 20 --w 50 --exp 10", "ar")).toBe("3:1");
    expect(Q().paramOf("--aspect 2:3", "ar")).toBe("2:3");
    expect(Q().paramOf("--c 20", "chaos")).toBe("20");
    expect(Q().paramOf("--cref x --chaos 5", "chaos")).toBe("5");
    expect(Q().paramOf("--weird 300", "weird")).toBe("300");
    expect(Q().paramOf("--stylize 250", "ar")).toBeNull();
    expect(Q().withParam("--ar 3:1 --stylize 250", "ar", "16:9")).toBe("--ar 16:9 --stylize 250");
    expect(Q().withParam("--stylize 250", "ar", "16:9")).toBe("--stylize 250 --ar 16:9");
    expect(Q().withParam("--aspect 3:1 --ar 1:1", "ar", "2:3")).toBe("--aspect 2:3");
    expect(Q().withParam("--aspect 3:1 --ar 1:1 --raw", "ar", null)).toBe("--raw");
    expect(Q().withParam("--c 10", "chaos", "")).toBe("");
  });

  test("Raw on and off, --style raw counts as raw", () => {
    expect(Q().isRaw("--ar 1:1 --raw")).toBe(true);
    expect(Q().isRaw("--style raw")).toBe(true);
    expect(Q().isRaw("--ar 1:1")).toBe(false);
    expect(Q().withRaw("--ar 1:1", true)).toBe("--ar 1:1 --raw");
    expect(Q().withRaw("--raw --ar 1:1 --raw", true)).toBe("--ar 1:1 --raw");
    expect(Q().withRaw("--style raw --ar 1:1", false)).toBe("--ar 1:1");
  });

  test("typed values are checked", () => {
    expect(Q().cleanParamValue("ar", " 16:9 ")).toEqual({ ok: true, value: "16:9" });
    expect(Q().cleanParamValue("ar", "wide").ok).toBe(false);
    expect(Q().cleanParamValue("chaos", "40")).toEqual({ ok: true, value: "40" });
    expect(Q().cleanParamValue("chaos", "140").ok).toBe(false);
    expect(Q().cleanParamValue("weird", "")).toEqual({ ok: true, value: null });
  });

  test("the thread shows shared values or mixed, from prompts still to send", () => {
    const items = [
      { id: "a", status: "queued", params: "--ar 3:1 --raw" },
      { id: "b", status: "injected", params: "--ar 3:1" },
      { id: "c", status: "sent", params: "--ar 1:1 --chaos 90" },
    ];
    const info = Q().threadParams(items);
    expect(info.count).toBe(2);
    expect(info.ar).toEqual({ value: "3:1", mixed: false });
    expect(info.raw.mixed).toBe(true);
    expect(info.chaos).toEqual({ value: null, mixed: false });
  });

  test("changes reach only prompts still to send, and only when they change", () => {
    const items = [
      { id: "a", status: "queued", params: "--ar 3:1 --stylize 250" },
      { id: "b", status: "queued", params: "--ar 3:1 --stylize 250 --raw" },
      { id: "c", status: "sent", params: "--ar 1:1" },
      { id: "d", status: "skipped", params: "" },
    ];
    const raw = Q().applyThreadParams(items, { raw: true });
    expect(raw.map((entry: any) => [entry.item.id, entry.params])).toEqual([["a", "--ar 3:1 --stylize 250 --raw"]]);
    const many = Q().applyThreadParams(items, { ar: "16:9", chaos: "20", stylize: 500 });
    expect(many.map((entry: any) => entry.params)).toEqual([
      "--ar 16:9 --stylize 500 --chaos 20",
      "--ar 16:9 --raw --stylize 500 --chaos 20",
    ]);
    expect(Q().applyThreadParams(items, { ar: "3:1" })).toEqual([]);
    expect(Q().applyThreadParams(items, { stylize: 250 })).toEqual([]);
  });
});

describe("the bar's text taken apart", () => {
  test("images, words, srefs, image weight, profile codes and params", () => {
    const parsed = Q().parseBarCommand(
      "https://x.test/a.png https://x.test/b.png a lantern-lit stair --sref 123 https://x.test/s.png::2 --iw 0.5 --profile abc m12345 --ar 3:1 --raw",
    );
    expect(parsed).toEqual({
      imagePrompts: [{ url: "https://x.test/a.png", weight: 0.5 }, { url: "https://x.test/b.png" }],
      prompt: "a lantern-lit stair",
      styleRefs: [{ code: "123" }, { url: "https://x.test/s.png", weight: 2 }],
      profileCodes: ["abc", "m12345"],
      params: "--ar 3:1 --raw",
    });
  });

  test("a composed command comes back to the same command", () => {
    const item = {
      prompt: "a rose window at dusk",
      imagePrompts: [{ url: "https://x.test/a.png", weight: 0.5 }],
      styleRefs: [{ code: "3534013297" }, { url: "https://x.test/s.png", weight: 2 }],
      profileCodes: ["vtrctg9"],
      params: "--ar 3:1 --stylize 750",
    };
    const command = C().composeMjCommand(item).command;
    expect(C().composeMjCommand(Q().parseBarCommand(command)).command).toBe(command);
  });

  test("smart dashes and -p count as flags", () => {
    expect(Q().parseBarCommand("a fox —ar 2:3 -p abc")).toMatchObject({ prompt: "a fox", params: "--ar 2:3", profileCodes: ["abc"] });
  });
});

describe("is the bar still the queued prompt", () => {
  const item = { id: "a", prompt: "A tall Gothic stair lit by candles in a stone hall", imagePrompts: [] };
  test("as queued, or edited, counts; another prompt does not", () => {
    expect(Q().belongsToItem("A tall Gothic stair lit by candles in a stone hall --ar 3:1", item)).toBe(true);
    expect(Q().belongsToItem("A tall Gothic stair lit by oil lamps in a stone hall --raw", item)).toBe(true);
    expect(Q().belongsToItem("a red fox in snow, close-up, morning light", item)).toBe(false);
    expect(Q().belongsToItem("", item)).toBe(false);
  });
  test("an image-only prompt needs one of its images", () => {
    const image = { id: "b", prompt: "", imagePrompts: [{ url: "https://x.test/a.png" }] };
    expect(Q().belongsToItem("https://x.test/a.png --ar 1:1", image)).toBe(true);
    expect(Q().belongsToItem("https://x.test/z.png", image)).toBe(false);
  });
});

describe("⌥⇧S guard and the send button", () => {
  test("a held key or a second press within 1.5 s never sends twice", () => {
    const now = 100000;
    expect(Q().sendKeyAllowed({ repeat: true, lastAt: 0, now })).toBe(false);
    expect(Q().sendKeyAllowed({ repeat: false, lastAt: 0, now })).toBe(true);
    expect(Q().sendKeyAllowed({ repeat: false, lastAt: now - 800, now })).toBe(false);
    expect(Q().sendKeyAllowed({ repeat: false, lastAt: now - Q().SEND_GUARD_MS, now })).toBe(true);
  });

  test("Midjourney's send button scores 3 or more; other bar buttons do not", () => {
    const score = Q().sendButtonScore;
    expect(score({ label: "Submit", hasSvg: true })).toBeGreaterThanOrEqual(3);
    expect(score({ hasSvg: true, rightmost: true })).toBeGreaterThanOrEqual(3);
    expect(score({ type: "submit" })).toBeGreaterThanOrEqual(3);
    expect(score({ hasSvg: true })).toBeLessThan(3);
    expect(score({ label: "Settings", hasSvg: true, rightmost: true })).toBeLessThan(3);
    expect(score({ label: "Add images", hasSvg: true, rightmost: true })).toBeLessThan(3);
    expect(score({ label: "Send", ours: true })).toBe(-1);
    expect(score({ label: "Send", disabled: true })).toBe(-1);
  });
});

describe("Test, Random and Extreme threads", () => {
  const moodboards = {
    ok: true,
    profiles: [{ code: "p1", name: "CINEMATIC" }, { code: "p2", name: "LOCATIONS" }, { code: "n9iqix8", name: "AndromedaCartoon" }],
    moodboards: [{ mjCode: "m1", shortName: "Night" }, { mjCode: "m2", name: "Dear Annete · Day", shortName: "Day" }],
  };

  test("thread names use the first five words", () => {
    expect(Q().variantThreadName("test", "A tall Gothic stair lit by candles")).toBe("Test · A tall Gothic stair lit");
    expect(Q().variantThreadName("random", "https://x.test/a.png a fox")).toBe("Random · a fox");
    expect(Q().variantThreadName("extreme", "")).toBe("Extreme · image prompt");
  });

  test("the pool comes from the dock's moodboards route", () => {
    const pool = Q().poolFromMoodboards(moodboards);
    expect(pool.profiles).toEqual(["p1", "p2", "n9iqix8"]);
    expect(pool.boards).toEqual(["m1", "m2"]);
    expect(pool.names).toMatchObject({ p1: "CINEMATIC", m2: "Day" });
  });

  test("Test: once with no profile, then once per profile, never AndromedaCartoon", () => {
    const list = Q().variantList("test", Q().poolFromMoodboards(moodboards), 4, R());
    expect(list.map((entry: any) => entry.label)).toEqual(["No profile", "CINEMATIC", "LOCATIONS"]);
    expect(list.map((entry: any) => entry.codes)).toEqual([[], ["p1"], ["p2"]]);
  });

  test("Random and Extreme keep their limits and the count (1 to 12)", () => {
    const pool = { profiles: ["p1", "p2", "p3", "p4"], boards: ["m1", "m2", "m3"], names: {} };
    const random = Q().variantList("random", pool, 6, R(), seeded(3));
    expect(random.length).toBe(6);
    for (const mix of random) {
      expect(mix.profiles.length).toBeLessThanOrEqual(2);
      expect(mix.boards.length).toBeLessThanOrEqual(1);
    }
    const extreme = Q().variantList("extreme", pool, 40, R(), seeded(4));
    expect(extreme.length).toBeLessThanOrEqual(12);
    for (const mix of extreme) {
      expect(mix.profiles.length).toBeLessThanOrEqual(3);
      expect(mix.boards.length).toBeLessThanOrEqual(2);
    }
  });

  test("a queued item as it is is copied; an edited bar is taken from the bar", () => {
    const item = { id: "i1", prompt: "a stone stair", profileCodes: ["x"], params: "--ar 3:1", worldKey: "dear-annete" };
    const composeCommand = (entry: any) => C().composeMjCommand(entry).command;
    const same = Q().variantSource(item, "a stone stair --profile x --ar 3:1", composeCommand);
    expect(same.mode).toBe("item");
    const edited = Q().variantSource(item, "a stone stair at night --profile x --ar 3:1 --raw", composeCommand);
    expect(edited.mode).toBe("bar");
    expect(edited.fields).toMatchObject({ prompt: "a stone stair at night", params: "--ar 3:1 --raw" });
    expect(edited.item).toBe(item);
    expect(Q().variantSource(item, "", composeCommand).mode).toBe("item");
    expect(Q().variantSource(null, "", composeCommand)).toBeNull();
  });

  test("requests: fork for an item (profile flags in params come out), fresh queue for the bar", () => {
    const variants = [{ label: "No profile", codes: [] }, { label: "CINEMATIC", codes: ["p1"] }];
    const item = { id: "i1", prompt: "a stone stair", params: "--ar 3:1 --p old1" };
    const fork = Q().variantRequest({ kind: "test", source: { mode: "item", item, words: item.prompt }, variants, R: R() });
    expect(fork).toEqual({
      action: "fork", itemId: "i1", batch: "Test · a stone stair", createdBy: "extension · test",
      variants: [
        { title: "No profile", profileCodes: [], params: "--ar 3:1" },
        { title: "CINEMATIC", profileCodes: ["p1"], params: "--ar 3:1" },
      ],
    });
    const fields = Q().parseBarCommand("https://x.test/a.png a fox --sref 77 --profile z --ar 1:1");
    const bar = Q().variantRequest({ kind: "random", source: { mode: "bar", fields, words: fields.prompt }, variants, worldKey: "dear-annete", R: R() });
    expect(bar).toMatchObject({ action: "queue", fresh: true, batch: "Random · a fox", world: "dear-annete" });
    expect(bar.items[1]).toEqual({
      title: "CINEMATIC", prompt: "a fox", imagePrompts: [{ url: "https://x.test/a.png" }], styleRefs: [{ code: "77" }], profileCodes: ["p1"], params: "--ar 1:1",
    });
  });

  test("makeVariantThread asks for the world's profiles and posts once", async () => {
    const posts: any[] = [];
    const res = await Q().makeVariantThread({
      kind: "test",
      item: { id: "i1", prompt: "a stone stair", params: "", worldKey: "dear-annete" },
      barValue: "",
      worldKey: "",
      R: R(),
      composeCommand: (entry: any) => C().composeMjCommand(entry).command,
      io: {
        listMoodboards: async (world: string) => (world === "dear-annete" ? moodboards : null),
        post: async (body: any) => {
          posts.push(body);
          return { ok: true, batch: body.batch, batchKey: body.batch.toLowerCase(), items: [] };
        },
      },
    });
    expect(res).toMatchObject({ ok: true, count: 3, batchKey: "test · a stone stair" });
    expect(posts.length).toBe(1);
    const none = await Q().makeVariantThread({ kind: "test", item: null, barValue: "a fox", worldKey: "", R: R(), io: { listMoodboards: async () => moodboards, post: async () => ({ ok: true }) } });
    expect(none.ok).toBe(false);
  });
});

describe("the page script sends only on Michael's own action", () => {
  const source = readFileSync(join(import.meta.dir, "..", "extension", "mj-queue.js"), "utf8");
  test("⌥⇧S skips to the next prompt and is guarded against a held key", () => {
    expect(source).toMatch(/sendKeyAllowed\(\{ repeat, lastAt: lastSendKeyAt \}\)/);
    expect(source).toMatch(/async function skipKey/);
    expect(source).toMatch(/status: "skipped"/);
  });
  test("a sent item is marked once", () => {
    expect(source).toMatch(/if \(marked\.has\(item\.id\)\) return false;/);
  });
});
