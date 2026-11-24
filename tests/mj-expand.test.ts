import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  EXPAND_PRESETS, buildExpandMessages, cleanPrevious, composeExpanded, expandPreset, imageWeightOf, lookNoteOf, parseExpandAnswer, splitCommand,
} from "../lib/mj-expand";
import { composeBrief } from "../lib/writer-brief";

type Made = { title?: string; words: string; prompt: string; text?: string; rest: string; profiles: string[]; srefs: Array<{ code?: string; url?: string; weight?: number }>; images: string[] };
type Item = Made & { change?: string; queued?: boolean; edits?: string[] };
type ExpandApi = {
  ATTACH: Array<{ key: string }>;
  moveForCode: (code: string) => { key: string; hot: string } | null;
  varyMoodboards: (items: Item[], pool: { boards: string[]; names?: Record<string, string> }, options?: { rng?: () => number }) => Item[];
  previousPrompts: (rows: unknown[], read?: (row: unknown) => string, count?: number) => string[];
  historyDecision: (input: { cache: { at: number } | null; lastReadAt: number; now: number }) => string;
  runRequest: (input: Record<string, unknown>) => Record<string, unknown>;
  historyKey: (tile: { jobId: string; index: number } | null, url: string) => string;
  recordRun: (list: unknown[], source: Record<string, unknown>, run: Record<string, unknown>) => Array<{ key: string; runs: Array<{ id: string; items: Item[] }> }>;
  updateRun: (list: unknown[], key: string, runId: string, fn: (run: { items: Item[] }) => unknown) => Array<{ key: string; runs: Array<{ id: string; items: Item[] }> }>;
  entryOf: (list: unknown[], key: string) => { key: string; runs: Array<{ id: string; items: Item[] }> } | null;
  recentRows: (list: unknown[], count?: number) => Array<{ key: string; set: string; count: number; queued: number; runs: number }>;
  pillText: (count: number, busy?: boolean) => string;
  MOVES: Array<{ key: string; label: string; count: number }>;
  placeBeside: (rect: { left: number; right: number; top: number; bottom: number }, view: { width: number; height: number }, size: { width: number; height: number }) => { x: number; y: number; side: string };
  threadLabel: (world: string, set: string, fallback?: string) => string;
  splitText: (text: string) => { images: string[]; words: string; tail: string };
  queueItemOf: (made: Made, source: { imageUrl?: string; pageUrl?: string; note?: string }, key: string) => Record<string, unknown>;
  codeLine: (command: string) => { images: string[]; words: string; srefs: string[]; profiles: string[]; rest: string };
  briefLine: (res: Record<string, unknown>) => string;
  shotSettingsOf: (stored: unknown) => { mode: string; from: string; fromName: string };
  shotFromOptions: (res: unknown, settings?: { from: string; fromName: string }) => Array<{ value: string; name: string; label: string }>;
};
const page = () => (globalThis as typeof globalThis & { SaveToGalleryExpand: ExpandApi }).SaveToGalleryExpand;

beforeAll(async () => {
  await import("../extension/mj-randomize.js");
  await import("../extension/mj-expand.js");
});

const COMMAND = "https://s.mj.run/abc A neon hearse idles under a gothic viaduct. Wet cobbles, sodium light. --ar 21:9 --stylize 250 --seed 77 --iw 0.5 --sref 123456::2 https://cdn.midjourney.com/u/x/y.png --sw 300 --profile h2eu2z6 m7510 --v 8.2 --hd";

describe("mj-expand: the source command", () => {
  test("splits into image prompts, words, codes and the other flags", () => {
    const split = splitCommand(COMMAND);
    expect(split.images).toEqual(["https://s.mj.run/abc"]);
    expect(split.words).toBe("A neon hearse idles under a gothic viaduct. Wet cobbles, sodium light.");
    expect(split.srefs).toEqual([{ code: "123456", weight: 2 }, { url: "https://cdn.midjourney.com/u/x/y.png" }]);
    expect(split.profiles).toEqual(["h2eu2z6", "m7510"]);
    // A seed pins one picture and --iw belongs to the image prompt: neither rides along.
    expect(split.rest).toBe("--ar 21:9 --stylize 250 --sw 300 --v 8.2 --hd");
    expect(split.aspect).toBe("21:9");
    expect(imageWeightOf(COMMAND)).toBe("0.5");
  });

  test("a prompt with no flags, and an empty one", () => {
    expect(splitCommand("a fox in snow")).toMatchObject({ words: "a fox in snow", rest: "", srefs: [], profiles: [], images: [] });
    expect(splitCommand(undefined).words).toBe("");
  });

  test("every result gets the source's codes back, unchanged", () => {
    const source = splitCommand(COMMAND);
    const made = composeExpanded("The reverse angle", "The viaduct seen from under its last arch.", source);
    expect(made.prompt).toBe("The viaduct seen from under its last arch. --ar 21:9 --stylize 250 --sw 300 --v 8.2 --hd --sref 123456::2 https://cdn.midjourney.com/u/x/y.png --profile h2eu2z6 m7510");
    expect(made.images).toEqual([]);
    expect(made.profiles).toEqual(["h2eu2z6", "m7510"]);
  });

  test("image prompts ride along only when asked; this frame can join as an sref", () => {
    const source = splitCommand(COMMAND);
    const kept = composeExpanded("t", "Words.", source, { keepImages: true, iw: "0.5", srefUrl: "https://cdn.midjourney.com/job/0_1.png" });
    expect(kept.prompt.startsWith("https://s.mj.run/abc Words. ")).toBe(true);
    expect(kept.prompt).toContain("--iw 0.5");
    expect(kept.srefs[0]).toEqual({ url: "https://cdn.midjourney.com/job/0_1.png" });
    const bare = composeExpanded("t", "Words.", splitCommand("a fox"), { fallbackAspect: "16:9" });
    expect(bare.prompt).toBe("Words. --ar 16:9");
  });
});

describe("mj-expand: the writer", () => {
  test("eleven moves, each with a count and a brief", () => {
    expect(EXPAND_PRESETS.map((preset) => preset.key)).toEqual(["angles", "close", "wide", "cast", "details", "story", "world", "scene", "place", "replay", "location"]);
    expect(expandPreset("story")?.count).toBe(7);
    // Every move writes at least six prompts (Michael, 23 Nov 2026: "at least 6-7").
    for (const preset of EXPAND_PRESETS) expect(preset.count).toBeGreaterThanOrEqual(6);
    expect(expandPreset("nope")).toBeNull();
    // The extension's chips are the same moves in the same order.
    expect(page().MOVES.map((move) => [move.key, move.count])).toEqual(EXPAND_PRESETS.map((preset) => [preset.key, preset.count]));
  });

  test("messages carry the picture, the source words, the move and the world's rules", () => {
    const source = splitCommand(COMMAND);
    const [system, user] = buildExpandMessages({
      image: "data:image/jpeg;base64,AAAA", sourceWords: source.words, lookNote: lookNoteOf(source), preset: expandPreset("story"),
      idea: "she is late for a funeral", count: 6, system: "Never a real city.",
      worldBrief: composeBrief("RETRO CYBERPUNK", [
        { key: "rules", label: "rules", title: "WORLD.md", text: "Cars are hearses." },
        { key: "learnings", label: "learnings", title: "LEARNINGS.md", text: "He likes sodium light." },
      ]).text,
    });
    expect(system!.content).toContain("Copy the style words exactly, names included");
    expect(system!.content).toContain("Cars are hearses.");
    expect(system!.content).toContain("He likes sodium light.");
    expect(system!.content).toContain("Never a real city.");
    const parts = user!.content as Array<{ type: string; text?: string }>;
    expect(parts[0]!.type).toBe("image_url");
    expect(parts[1]!.text).toContain("SOURCE PROMPT");
    expect(parts[1]!.text).toContain("A neon hearse idles");
    expect(parts[1]!.text).toContain("THE MOVE: Story");
    expect(parts[1]!.text).toContain("ART DIRECTOR'S STEER");
    expect(parts[1]!.text).toContain("LOGLINE:");
    expect(parts[1]!.text).not.toContain("123456");
  });

  test("an idea alone asks for takes; no source prompt reads the look from the picture", () => {
    const [, user] = buildExpandMessages({ image: "https://x/y.png", idea: "the driver's hands", count: 3 });
    const text = (user!.content as Array<{ text?: string }>)[1]!.text!;
    expect(text).toContain("There is no source prompt");
    expect(text).toContain("ART DIRECTOR'S IDEA: the driver's hands");
    expect(text).toContain("Write 3 prompts");
  });

  test("answers parse into a set, a logline and titled prompts; flags and links cut", () => {
    const parsed = parseExpandAnswer([
      "SET: Late for the funeral",
      "LOGLINE: A driver crosses the night city with the wrong coffin.",
      "",
      "1) TITLE: The viaduct at dusk.",
      "PROMPT: A neon hearse idles under a gothic viaduct. Wet cobbles. --ar 16:9",
      "",
      "**TITLE:** Her hands on the wheel",
      "**PROMPT:** Two gloved hands grip a thin steering wheel.",
      "Sodium light crosses the knuckles.",
      "TITLE: Empty",
      "PROMPT:",
    ].join("\n"));
    expect(parsed.set).toBe("Late for the funeral");
    expect(parsed.logline).toBe("A driver crosses the night city with the wrong coffin");
    expect(parsed.items).toEqual([
      { title: "The viaduct at dusk", words: "A neon hearse idles under a gothic viaduct. Wet cobbles." },
      { title: "Her hands on the wheel", words: "Two gloved hands grip a thin steering wheel. Sodium light crosses the knuckles." },
    ]);
    expect(parseExpandAnswer("I cannot help with that.").items).toEqual([]);
  });
});

describe("mj-expand: the card", () => {
  const size = { width: 384, height: 400 };
  const view = { width: 1600, height: 900 };

  test("sits beside the picture, never on it when a side has room", () => {
    expect(page().placeBeside({ left: 100, right: 500, top: 120, bottom: 520 }, view, size)).toEqual({ x: 512, y: 120, side: "right" });
    expect(page().placeBeside({ left: 900, right: 1500, top: 40, bottom: 640 }, view, size)).toEqual({ x: 504, y: 40, side: "left" });
    // A picture that fills the width: over its right edge, inside the viewport.
    const over = page().placeBeside({ left: 200, right: 1400, top: 700, bottom: 1500 }, view, size);
    expect(over.side).toBe("over-right");
    expect(over.x).toBe(1600 - 384 - 10);
    expect(over.y).toBe(900 - 400 - 10);
  });

  test("a set goes to its own thread, named after the world and the set", () => {
    expect(page().threadLabel("RETRO CYBERPUNK — night city", "Late for the funeral")).toBe("RETRO CYBERPUNK · Late for the funeral");
    expect(page().threadLabel("", "", "the driver's hands")).toBe("Explore · the driver's hands");
    expect(page().threadLabel("", "")).toBe("Explore · Grown");
  });

  test("a queued result keeps words, codes and params apart", () => {
    const made = composeExpanded("The reverse angle", "The viaduct from under its last arch.", splitCommand(COMMAND));
    const item = page().queueItemOf({ ...made, text: made.prompt }, { imageUrl: "https://cdn.midjourney.com/job/0_1.png", pageUrl: "https://www.midjourney.com/jobs/job?index=1", note: "Grown from a frame" }, "grow:job-1:r:0");
    expect(item).toEqual({
      ingestKey: "grow:job-1:r:0", title: "The reverse angle", note: "Grown from a frame",
      prompt: "The viaduct from under its last arch.",
      params: "--ar 21:9 --stylize 250 --sw 300 --v 8.2 --hd",
      profileCodes: ["h2eu2z6", "m7510"],
      styleRefs: [{ code: "123456", weight: 2 }, { url: "https://cdn.midjourney.com/u/x/y.png" }],
      describe: { sourceUrl: "https://cdn.midjourney.com/job/0_1.png", pageUrl: "https://www.midjourney.com/jobs/job?index=1", descriptions: [], mode: "keep" },
    });
  });

  test("an edited result is queued exactly as typed", () => {
    const made = composeExpanded("t", "Old words.", splitCommand(COMMAND));
    const item = page().queueItemOf({ ...made, text: "https://s.mj.run/zz New words here. --ar 1:1 --sref 9 --profile abc" }, {}, "k");
    expect(item.prompt).toBe("New words here.");
    expect(item.params).toBe("--ar 1:1 --sref 9 --profile abc");
    expect(item.imagePrompts).toEqual([{ url: "https://s.mj.run/zz" }]);
    expect(item.profileCodes).toBeUndefined();
  });

  test("the code line shows what rides along", () => {
    const line = page().codeLine(COMMAND);
    expect(line.srefs).toEqual(["123456::2", "https://cdn.midjourney.com/u/x/y.png"]);
    expect(line.profiles).toEqual(["h2eu2z6", "m7510"]);
    expect(line.rest).toBe("--ar 21:9 --stylize 250 --sw 300 --v 8.2 --hd");
    expect(line.images).toEqual(["https://s.mj.run/abc"]);
  });
});

describe("mj-expand: use this image as", () => {
  const source = splitCommand(COMMAND);
  const url = "https://cdn.midjourney.com/job/0_1.png";

  test("a style reference goes first in --sref; an image ref leads the command; edit adds --edit", () => {
    expect(composeExpanded("t", "Words.", source, { attach: "sref", attachUrl: url }).srefs[0]).toEqual({ url });
    const image = composeExpanded("t", "Words.", source, { attach: "image", attachUrl: url });
    expect(image.prompt.startsWith(`${url} Words. `)).toBe(true);
    expect(image.images).toEqual([url]);
    const edit = composeExpanded("t", "Words.", source, { attach: "edit", attachUrl: url });
    expect(edit.prompt.endsWith(`--edit ${url}`)).toBe(true);
    expect(edit.edits).toEqual([url]);
    // Codes and params stay in every mode.
    for (const made of [image, edit]) {
      expect(made.prompt).toContain("--profile h2eu2z6 m7510");
      expect(made.prompt).toContain("--sref 123456::2");
      expect(made.prompt).toContain("--stylize 250");
    }
    expect(composeExpanded("t", "Words.", source, { attach: "none", attachUrl: url }).prompt).not.toContain(url.replace(".png", ""));
    // No link: nothing is attached.
    expect(composeExpanded("t", "Words.", source, { attach: "edit" }).edits).toEqual([]);
  });

  test("AndromedaCartoon never rides along, and old versions become 8.2", () => {
    const old = splitCommand("a fox --profile n9iqix8 abc --v 8.1");
    expect(old.profiles).toEqual(["abc"]);
    expect(old.rest).toBe("--v 8.2");
    expect(composeExpanded("t", "Words.", old).prompt).toBe("Words. --v 8.2 --profile abc");
  });

  test("the writer is told what the attachment carries", () => {
    const [, user] = buildExpandMessages({ image: "https://x/y.png", preset: expandPreset("location"), count: 6, attach: "edit" });
    const text = (user!.content as Array<{ text?: string }>)[1]!.text!;
    expect(text).toContain("EDIT MODEL");
    expect(text).toContain("PLACE LINE:");
    expect(text).toContain("LIGHT LINE:");
    expect(expandPreset("location")!.brief).toContain("word for word");
  });

  test("the queue carries the edit frame in the params", () => {
    const made = composeExpanded("t", "Words.", source, { attach: "edit", attachUrl: url });
    const item = page().queueItemOf({ ...made, text: made.prompt }, {}, "k");
    expect(item.params).toBe(`--ar 21:9 --stylize 250 --sw 300 --v 8.2 --hd --edit ${url}`);
    expect(page().ATTACH.map((entry) => entry.key)).toEqual(["none", "sref", "image", "edit"]);
  });
});

describe("mj-expand: cinematic rules and previous prompts", () => {
  test("every move carries the cinematic rules; Dear Annete adds its addendum", () => {
    const plain = buildExpandMessages({ image: "https://x/y.png", count: 3, worldKey: "cassandra" })[0]!.content as string;
    expect(plain).toContain("CINEMATIC RULES");
    expect(plain).not.toContain("DEAR ANNETE ADDENDUM");
    const da = buildExpandMessages({ image: "https://x/y.png", count: 3, worldKey: "dear-annete-art-deco" })[0]!.content as string;
    expect(da).toContain("DEAR ANNETE ADDENDUM");
    expect(da).toContain("real cinematography comes first");
    expect(plain).not.toMatch(/mechanical hand/i);
  });

  test("previous prompts are cleaned and handed over newest first; Replay rewrites them one by one", () => {
    const previous = ["A lane at dawn --ar 16:9 https://cdn.midjourney.com/a.png", "a lane at dawn --ar 1:1", "", "A kitchen at noon"];
    expect(cleanPrevious(previous)).toEqual(["A lane at dawn --ar 16:9", "A kitchen at noon"]);
    const [, user] = buildExpandMessages({ image: "https://x/y.png", preset: expandPreset("replay"), count: 2, previous });
    const text = (user!.content as Array<{ text?: string }>)[1]!.text!;
    expect(text).toContain("PREVIOUS PROMPTS");
    expect(text).toContain("1. A lane at dawn");
    expect(text).toContain("rewrite each one as the move says");
    const [, steer] = buildExpandMessages({ image: "https://x/y.png", idea: "a wide", count: 3, previous });
    expect((steer!.content as Array<{ text?: string }>)[1]!.text).toContain("visual DNA of the source image");
  });
});

describe("mj-expand card: moves, moodboards, history", () => {
  test("keys 1–9, 0 and L pick moves", () => {
    expect(page().moveForCode("Digit8")?.key).toBe("scene");
    expect(page().moveForCode("Digit9")?.key).toBe("place");
    expect(page().moveForCode("Digit0")?.key).toBe("replay");
    expect(page().moveForCode("KeyL")?.key).toBe("location");
    expect(page().moveForCode("KeyQ")).toBeNull();
  });

  test("vary moodboards swaps one moodboard per result and keeps taste profiles", () => {
    const made = composeExpanded("t", "Words.", splitCommand("A lane. --ar 16:9 --profile m1 taste1 --stylize 750"));
    const items = [made, made, made].map((item) => ({ ...item, text: item.prompt }));
    const pool = { boards: ["m1", "m2", "m3", "n9iqix8"], names: { m1: "FOG", m2: "ROSE", m3: "ASH" } };
    const varied = page().varyMoodboards(items, pool, { rng: () => 0 });
    for (const item of varied) {
      expect(item.profiles).toContain("taste1");
      expect(item.profiles.filter((code) => pool.boards.includes(code))).toHaveLength(1);
      expect(item.profiles).not.toContain("n9iqix8");
      expect(item.prompt).toContain("--stylize 750");
      expect(item.text).toBe(item.prompt);
    }
    expect(varied.map((item) => item.change)).toEqual(["FOG → ROSE", "FOG → ASH", "FOG → ROSE"]);
    // No moodboard of the world in the source: one is added.
    const bare = composeExpanded("t", "Words.", splitCommand("A lane. --profile taste1"));
    const added = page().varyMoodboards([{ ...bare, text: bare.prompt }], { boards: ["m2"], names: { m2: "ROSE" } });
    expect(added[0]!.profiles).toEqual(["m2", "taste1"]);
    expect(added[0]!.change).toBe("+ ROSE");
    // An empty pool changes nothing.
    expect(page().varyMoodboards([{ ...bare }], { boards: [] })[0]!.change).toBeUndefined();
  });

  test("previous prompts come newest first, repeats dropped, at most ten", () => {
    const rows = [
      { enqueue_time: "2026-11-17T10:00:00Z", full_command: "old prompt --ar 1:1" },
      { enqueue_time: "2026-11-17T12:00:00Z", full_command: "new prompt --ar 16:9" },
      { enqueue_time: "2026-11-17T11:00:00Z", full_command: "New prompt --ar 2:3" },
      { enqueue_time: "2026-11-17T09:00:00Z", prompt: { full_command: "nested prompt" } },
      { enqueue_time: "2026-11-17T08:00:00Z" },
    ];
    expect(page().previousPrompts(rows)).toEqual(["new prompt --ar 16:9", "old prompt --ar 1:1", "nested prompt"]);
    const many = Array.from({ length: 15 }, (_, i) => ({ enqueue_time: new Date(2026, 10, 17, i).toISOString(), full_command: `prompt ${i}` }));
    expect(page().previousPrompts(many)).toHaveLength(10);
    expect(page().previousPrompts(many)[0]).toBe("prompt 14");
  });

  test("Midjourney's history is read gently", () => {
    const now = 1_000_000;
    expect(page().historyDecision({ cache: { at: now - 30_000 }, lastReadAt: now - 30_000, now })).toBe("reuse");
    expect(page().historyDecision({ cache: { at: now - 90_000 }, lastReadAt: now - 90_000, now })).toBe("read");
    expect(page().historyDecision({ cache: null, lastReadAt: now - 5_000, now })).toBe("wait");
    expect(page().historyDecision({ cache: { at: now - 90_000 }, lastReadAt: now - 5_000, now })).toBe("reuse");
    expect(page().historyDecision({ cache: null, lastReadAt: 0, now })).toBe("read");
  });

  test("the run request carries the attachment and the previous prompts only when asked", () => {
    const source = { command: "a lane --profile m1", srefUrl: "https://cdn.midjourney.com/j/0_1.png" };
    const image = { dataUrl: "data:image/jpeg;base64,AAAA", width: 1024, height: 768 };
    const previous = ["a", "b"];
    const off = page().runRequest({ image, source, move: { key: "wide" }, world: "auto", attach: "edit", previous, replay: false });
    expect(off).toMatchObject({ preset: "wide", attach: "edit", attachUrl: source.srefUrl, world: "auto", width: 1024 });
    expect(off.previous).toBeUndefined();
    expect(page().runRequest({ image, source, move: null, idea: " a door ", replay: true, previous }).previous).toEqual(previous);
    expect(page().runRequest({ image, source, move: { key: "replay" }, previous }).previous).toEqual(previous);
    expect(page().runRequest({ image, source: { command: "" }, attach: "sref" }).attach).toBeUndefined();
    expect(page().runRequest({ image, source, world: "none" }).world).toBeUndefined();
  });

  test("every run is kept per picture: newest first, capped, queued marks saved", () => {
    expect(page().historyKey({ jobId: "job", index: 2 }, "https://x")).toBe("job-2");
    expect(page().historyKey(null, " https://x/y.png ")).toBe("https://x/y.png");
    const source = { key: "job-2", rendered: "https://cdn/x.webp", imageUrl: "https://cdn/x.webp", srefUrl: "https://cdn/x.png", command: "a lane" };
    const item = { title: "T", words: "W", prompt: "W --ar 1:1", text: "W --ar 1:1", rest: "--ar 1:1", profiles: [], srefs: [], images: [] };
    let list: unknown[] = [];
    for (let i = 0; i < 10; i += 1) list = page().recordRun(list, source, { id: `r${i}`, at: i, set: `Set ${i}`, items: [item, item] });
    const entry = page().entryOf(list, "job-2")!;
    expect(entry.runs).toHaveLength(8);
    expect(entry.runs[0]!.id).toBe("r9");
    // An unedited item is stored without its duplicate text.
    expect(entry.runs[0]!.items[0]).not.toHaveProperty("text");
    list = page().updateRun(list, "job-2", "r9", (run) => ({ ...run, items: run.items.map((one, index) => ({ ...one, queued: index === 0 })) }));
    expect(page().entryOf(list, "job-2")!.runs[0]!.items[0]!.queued).toBe(true);
    for (let i = 0; i < 45; i += 1) list = page().recordRun(list, { ...source, key: `p${i}` }, { id: "x", at: 100 + i, items: [item] });
    expect(list).toHaveLength(40);
    expect(page().entryOf(list, "p44")).not.toBeNull();
    expect(page().entryOf(list, "job-2")).toBeNull();
    const rows = page().recentRows(list, 3);
    expect(rows.map((row) => row.key)).toEqual(["p44", "p43", "p42"]);
    expect(rows[0]).toMatchObject({ count: 1, runs: 1, queued: 0 });
    expect(page().pillText(6)).toBe("6 prompts");
    expect(page().pillText(1)).toBe("1 prompt");
    expect(page().pillText(0, true)).toBe("writing…");
  });
});

describe("mj-expand: the Shots switch", () => {
  test("a missing or odd setting means auto from the shelf", () => {
    expect(page().shotSettingsOf(null)).toEqual({ mode: "auto", from: "", fromName: "" });
    expect(page().shotSettingsOf({ mode: "loud", from: 4 })).toEqual({ mode: "auto", from: "", fromName: "" });
    expect(page().shotSettingsOf({ mode: "random", from: "f2", fromName: "NERVY" })).toEqual({ mode: "random", from: "f2", fromName: "NERVY" });
  });

  test("the from list puts the shelf first as the default and names the rest once", () => {
    const res = { shelf: "s1", sources: [
      { id: "s1", name: "CINEMATIC SHOTS", depth: 0, count: 49 },
      { id: "c1", name: "CINEMATIC", depth: 0, count: 128 },
      { id: "s1", name: "CINEMATIC SHOTS", depth: 1, count: 49 },
      { id: "n1", name: "NERVY — Night Rooftop Plates", depth: 1, count: 2 },
    ] };
    const options = page().shotFromOptions(res);
    expect(options.map((entry) => entry.value)).toEqual(["", "c1", "n1"]);
    expect(options[0]!.label).toBe("CINEMATIC SHOTS (49)");
    expect(options[2]!.label).toBe("· NERVY — Night Rooftop Plates (2)");
    // Before the list loads, a chosen collection still shows by its name.
    expect(page().shotFromOptions(null, { from: "n1", fromName: "NERVY" }).map((entry) => entry.label)).toEqual(["CINEMATIC SHOTS", "NERVY"]);
  });

  test("the status line says the shots were read, with or without a world", () => {
    expect(page().briefLine({ read: ["cinematic shots (4 random)"] })).toBe("cinematic shots (4 random)");
    expect(page().briefLine({ world: "Dear Annete", read: ["rules", "cinematic shots (8)"] })).toBe("DEAR ANNETE: rules, cinematic shots (8)");
    expect(page().briefLine({})).toBe("");
  });
});

describe("every Midjourney prompt is its own picture (23 Nov 2026)", () => {
  test("Grow's always-on rules forbid words that point at another view, even under his own system prompt", async () => {
    const { buildExpandMessages: build, expandPreset: preset } = await import("../lib/mj-expand");
    const [system] = build({ image: "data:image/jpeg;base64,AAAA", sourceWords: "", preset: preset("angles"), count: 6, rules: "My own rules." });
    expect(String(system!.content)).toContain("EVERY MIDJOURNEY PROMPT IS ITS OWN PICTURE");
    expect(String(system!.content)).toContain("Seedream 5.5 Pro");
  });

  test("no move brief or location rule models a pointing word", async () => {
    const { EXPAND_PRESETS: presets } = await import("../lib/mj-expand");
    const { CINEMATIC_RULES, pointsElsewhere } = await import("../lib/mj-prompt-knowledge");
    // Words in quotes are the ones a brief forbids; only the wording it models counts.
    for (const move of presets) expect(move.brief.replace(/"[^"]*"/g, "")).not.toMatch(/reverse angle|looking back|wide reverse|the way this camera looks/i);
    expect(CINEMATIC_RULES).not.toMatch(/wide reverse|Reverse wide|looking back down/);
    expect(pointsElsewhere("Wide reverse angle of the square, looking back toward the church.")).toBe("reverse angle");
    expect(pointsElsewhere("From the church steps, a cobbled square opens toward narrow houses.")).toBe("");
  });
});

describe("Grow uses only the world he picks (23 Nov 2026)", () => {
  const card = () => readFileSync(new URL("../extension/mj-expand.js", import.meta.url), "utf8");
  test("the world picker has its own labelled row, defaults to No world and never guesses", () => {
    const source = card();
    expect(source).toContain('<div class="opt"><b>World</b><select class="world"');
    expect(source).not.toMatch(/<div class="top">[^\n]*<select title="World/);
    expect(source).toContain('worlds: [], world: "none"');
    expect(source).toContain('stored[STORE.world] !== "auto" ? stored[STORE.world] : "none"');
    expect(source).toContain('const worldKey = () => (state.world === "none" ? "" : state.world);');
  });
  test("a run with No world sends no world to the writer", () => {
    expect(page().runRequest({ image: { dataUrl: "data:," }, world: "none" }).world).toBeUndefined();
    expect(page().runRequest({ image: { dataUrl: "data:," }, world: "andromeda-anya" }).world).toBe("andromeda-anya");
  });
});
