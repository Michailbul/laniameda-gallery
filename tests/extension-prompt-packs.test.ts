import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Pack = { id: string; label: string; phrase: string };
type Group = { heading: string; note?: string; packs: Pack[] };
type Result = { text: string; caret: number };
type Options = { mode?: "cursor" | "before" | "after"; caret?: number | null };
type PacksApi = {
  flagStart: (text: string) => number;
  hasPack: (text: string, phrase: string) => boolean;
  insertPack: (text: string, phrase: string, options?: Options) => Result;
  removePack: (text: string, phrase: string) => Result;
  togglePack: (text: string, phrase: string, options?: Options) => Result;
};

const root = globalThis as typeof globalThis & {
  SaveToGalleryPromptPacks: PacksApi;
  SaveToGalleryPromptPackData: Group[];
};
const api = () => root.SaveToGalleryPromptPacks;
const data = () => root.SaveToGalleryPromptPackData;
const pack = (id: string) => {
  const found = data().flatMap((group) => group.packs).find((p) => p.id === id);
  if (!found) throw new Error(`no pack ${id}`);
  return found.phrase;
};

beforeAll(async () => {
  await import("../extension/prompt-packs-data.js");
  await import("../extension/prompt-packs.js");
});

describe("prompt pack data", () => {
  test("groups and packs match the brief", () => {
    expect(data().map((group) => group.heading)).toEqual([
      "Style",
      "Where",
      "Light",
      "Camera",
      "Wardrobe",
      "World markers",
      "Strange, still this world",
    ]);
    expect(
      data().map((group) => group.packs.map((p) => p.label)),
    ).toEqual([
      ["Film", "3D"],
      ["Lower city", "Upper towers", "Exterior", "Interior"],
      ["Golden", "Night", "Lamp"],
      ["Close", "Wide"],
      ["Court", "Dari", "Mike"],
      ["Cable car", "Sled", "Bridge", "Merge"],
      ["Pale", "Crimson valley"],
    ]);
  });

  test("ids are unique and no phrase contains another", () => {
    const packs = data().flatMap((group) => group.packs);
    expect(new Set(packs.map((p) => p.id)).size).toBe(packs.length);
    for (const a of packs) {
      for (const b of packs) {
        if (a !== b) expect(a.phrase.includes(b.phrase)).toBe(false);
      }
    }
  });

  test("keeps the banned words out", () => {
    const banned =
      /\b(prague|cyberpunk|neon|painterly|hand-painted|medieval|castle|gotham|tram|cozy|surrealism|gilded)\b/i;
    for (const group of data()) {
      for (const p of group.packs) expect(banned.test(p.phrase)).toBe(false);
    }
  });

  test("UI reads phrases from the data file, none are hardcoded in the logic", () => {
    const source = readFileSync(
      new URL("../extension/prompt-packs.js", import.meta.url),
      "utf8",
    );
    for (const group of data()) {
      for (const p of group.packs) expect(source.includes(p.phrase)).toBe(false);
    }
  });
});

describe("togglePack", () => {
  const film = () => pack("film");
  const golden = () => pack("golden");

  test("empty box gets the phrase and the caret lands after it", () => {
    const out = api().togglePack("", film());
    expect(out.text).toBe(film());
    expect(out.caret).toBe(film().length);
  });

  test("cursor at the end appends, with one space", () => {
    const out = api().togglePack("a woman at a window", film(), {
      mode: "cursor",
      caret: 19,
    });
    expect(out.text).toBe(`a woman at a window ${film()}`);
  });

  test("cursor click order is phrase order", () => {
    const first = api().togglePack("a woman", film(), { mode: "cursor", caret: 7 });
    const second = api().togglePack(first.text, golden(), {
      mode: "cursor",
      caret: first.caret,
    });
    expect(second.text).toBe(`a woman ${film()} ${golden()}`);
  });

  test("cursor at the start puts the pack in front of the idea", () => {
    const out = api().togglePack("a woman at a window", film(), {
      mode: "cursor",
      caret: 0,
    });
    expect(out.text).toBe(`${film()} a woman at a window`);
  });

  test("cursor inside a word moves to the end of that word", () => {
    const out = api().togglePack("a woman at a window", film(), {
      mode: "cursor",
      caret: 4,
    });
    expect(out.text).toBe(`a woman ${film()} at a window`);
  });

  test("cursor behind the flags clamps to the end of the words", () => {
    const text = "a woman --ar 2:3";
    const out = api().togglePack(text, film(), { mode: "cursor", caret: text.length });
    expect(out.text).toBe(`a woman ${film()} --ar 2:3`);
  });

  test("no caret falls back to appending", () => {
    const out = api().togglePack("a woman", film(), { mode: "cursor", caret: null });
    expect(out.text).toBe(`a woman ${film()}`);
  });

  test("before puts packs in front, later clicks stay in click order", () => {
    const first = api().togglePack("a woman", film(), { mode: "before" });
    expect(first.text).toBe(`${film()} a woman`);
    const second = api().togglePack(first.text, golden(), { mode: "before" });
    expect(second.text).toBe(`${film()} ${golden()} a woman`);
  });

  test("before keeps leading image urls in front", () => {
    const out = api().togglePack("https://s.mj.run/abc123 a woman", film(), {
      mode: "before",
    });
    expect(out.text).toBe(`https://s.mj.run/abc123 ${film()} a woman`);
  });

  test("before on an empty box leaves just the phrase", () => {
    expect(api().togglePack("", film(), { mode: "before" }).text).toBe(film());
  });

  test("after goes behind the words and in front of the flags", () => {
    const out = api().togglePack("a woman --ar 2:3 --profile abc", film(), {
      mode: "after",
    });
    expect(out.text).toBe(`a woman ${film()} --ar 2:3 --profile abc`);
  });

  test("flags are byte-identical after insert and remove, in every mode", () => {
    const flags = "--ar 16:9 --stylize 250 -p gms8ial h2eu2z6 --profile abc --v 7";
    for (const mode of ["cursor", "before", "after"] as const) {
      for (const text of [`a woman ${flags}`, flags, `${flags}`]) {
        const added = api().togglePack(text, film(), { mode, caret: 0 });
        expect(added.text.endsWith(flags)).toBe(true);
        expect(added.text.includes(film())).toBe(true);
        const removed = api().togglePack(added.text, film(), { mode });
        expect(removed.text).toBe(text);
      }
    }
  });

  test("flags-only prompt gets the pack in front of the flags", () => {
    const out = api().togglePack("--ar 2:3", film(), { mode: "after" });
    expect(out.text).toBe(`${film()} --ar 2:3`);
  });

  test("same pack again removes it from any position", () => {
    const text = `a woman ${film()} ${golden()} --ar 2:3`;
    expect(api().togglePack(text, film()).text).toBe(`a woman ${golden()} --ar 2:3`);
    expect(api().togglePack(text, golden()).text).toBe(`a woman ${film()} --ar 2:3`);
    expect(api().togglePack(`${film()} a woman`, film()).text).toBe("a woman");
    expect(api().togglePack(`a woman ${film()}`, film()).text).toBe("a woman");
    expect(api().togglePack(film(), film()).text).toBe("");
  });

  test("a phrase typed behind the flags does not count as present", () => {
    const text = `a woman --no ${film()}`;
    expect(api().hasPack(text, film())).toBe(false);
  });

  test("every phrase in the data file round-trips", () => {
    for (const group of data()) {
      for (const p of group.packs) {
        const added = api().togglePack("a woman --ar 2:3", p.phrase, { mode: "after" });
        expect(added.text).toBe(`a woman ${p.phrase} --ar 2:3`);
        expect(api().hasPack(added.text, p.phrase)).toBe(true);
        expect(api().togglePack(added.text, p.phrase).text).toBe("a woman --ar 2:3");
      }
    }
  });
});
