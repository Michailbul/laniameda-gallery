import { beforeAll, describe, expect, test } from "bun:test";
import {
  EXPAND_PRESETS, buildExpandMessages, composeExpanded, expandPreset, imageWeightOf, lookNoteOf, parseExpandAnswer, splitCommand,
} from "../lib/mj-expand";

type Made = { title?: string; words: string; prompt: string; text?: string; rest: string; profiles: string[]; srefs: Array<{ code?: string; url?: string; weight?: number }>; images: string[] };
type ExpandApi = {
  MOVES: Array<{ key: string; label: string; count: number }>;
  placeBeside: (rect: { left: number; right: number; top: number; bottom: number }, view: { width: number; height: number }, size: { width: number; height: number }) => { x: number; y: number; side: string };
  threadLabel: (world: string, set: string, fallback?: string) => string;
  splitText: (text: string) => { images: string[]; words: string; tail: string };
  queueItemOf: (made: Made, source: { imageUrl?: string; pageUrl?: string; note?: string }, key: string) => Record<string, unknown>;
  codeLine: (command: string) => { images: string[]; words: string; srefs: string[]; profiles: string[]; rest: string };
};
const page = () => (globalThis as typeof globalThis & { SaveToGalleryExpand: ExpandApi }).SaveToGalleryExpand;

beforeAll(async () => {
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
  test("seven moves, each with a count and a brief", () => {
    expect(EXPAND_PRESETS.map((preset) => preset.key)).toEqual(["angles", "close", "wide", "cast", "details", "story", "world"]);
    expect(expandPreset("story")?.count).toBe(6);
    expect(expandPreset("nope")).toBeNull();
    // The extension's chips are the same moves in the same order.
    expect(page().MOVES.map((move) => [move.key, move.count])).toEqual(EXPAND_PRESETS.map((preset) => [preset.key, preset.count]));
  });

  test("messages carry the picture, the source words, the move and the world's rules", () => {
    const source = splitCommand(COMMAND);
    const [system, user] = buildExpandMessages({
      image: "data:image/jpeg;base64,AAAA", sourceWords: source.words, lookNote: lookNoteOf(source), preset: expandPreset("story"),
      idea: "she is late for a funeral", count: 6, system: "Never a real city.", worldName: "retro-cyberpunk", worldDoc: "Cars are hearses.", learnings: "He likes sodium light.",
    });
    expect(system!.content).toContain("Copy them word for word");
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
