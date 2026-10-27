import { beforeAll, describe, expect, test } from "bun:test";

type DockApi = {
  applyMoodboardToPrompt: (
    promptText: string,
    code: string,
    moodboardCodes: string[],
  ) => string;
  chipLabel: (
    board: { name?: string; shortName?: string; mjCode?: string },
    boards: { name?: string; shortName?: string; mjCode?: string }[],
  ) => string;
};

const getApi = () =>
  (globalThis as typeof globalThis & { SaveToGalleryMoodboardDock: DockApi })
    .SaveToGalleryMoodboardDock;

beforeAll(async () => {
  await import("../extension/moodboard-dock.js");
});

const CODES = ["gms8ial", "88ji6bg", "5no6b1c"];
const apply = (prompt: string, code: string) =>
  getApi().applyMoodboardToPrompt(prompt, code, CODES);

describe("applyMoodboardToPrompt", () => {
  test("empty prompt becomes a bare flag", () => {
    expect(apply("", "88ji6bg")).toBe("-p 88ji6bg");
  });

  test("appends a flag when none exists", () => {
    expect(apply("a window --ar 2:3", "88ji6bg")).toBe(
      "a window --ar 2:3 -p 88ji6bg",
    );
  });

  test("does not add a second space after trailing whitespace", () => {
    expect(apply("a window ", "88ji6bg")).toBe("a window -p 88ji6bg");
  });

  test("keeps taste codes and puts the moodboard first", () => {
    expect(apply("a window --profile h2eu2z6 --ar 2:3", "88ji6bg")).toBe(
      "a window -p 88ji6bg h2eu2z6 --ar 2:3",
    );
  });

  test("swaps one moodboard code for another", () => {
    expect(apply("a window --profile 88ji6bg h2eu2z6", "5no6b1c")).toBe(
      "a window -p 5no6b1c h2eu2z6",
    );
  });

  test("second click clears the moodboard and keeps taste codes", () => {
    expect(apply("a window -p 88ji6bg h2eu2z6", "88ji6bg")).toBe(
      "a window -p h2eu2z6",
    );
  });

  test("second click removes the whole flag when nothing remains", () => {
    expect(apply("a window -p 88ji6bg --ar 2:3", "88ji6bg")).toBe(
      "a window --ar 2:3",
    );
    expect(apply("-p 88ji6bg", "88ji6bg")).toBe("");
    expect(apply("-p 88ji6bg --ar 2:3", "88ji6bg")).toBe("--ar 2:3");
  });

  test("merges several profile flags into the first", () => {
    expect(apply("a window --profile gms8ial --p h2eu2z6", "88ji6bg")).toBe(
      "a window -p 88ji6bg h2eu2z6",
    );
  });

  test("leaves other flags and image urls untouched", () => {
    const prompt =
      "https://s.mj.run/abc123 a window --stylize 100 --ar 2:3 --profile h2eu2z6";
    expect(apply(prompt, "88ji6bg")).toBe(
      "https://s.mj.run/abc123 a window --stylize 100 --ar 2:3 -p 88ji6bg h2eu2z6",
    );
  });
});

describe("chipLabel", () => {
  const boards = [
    { name: "DA FILM \u00b7 Golden", shortName: "Golden", mjCode: "88ji6bg" },
    { name: "DA CRIMSON PAINTED \u00b7 World", shortName: "World", mjCode: "csqchnb" },
    { name: "DA LACQUER 3D \u00b7 World", shortName: "World", mjCode: "h2rdly5" },
  ];

  test("keeps a unique short name", () => {
    expect(getApi().chipLabel(boards[0], boards)).toBe("Golden");
  });

  test("uses the prefix when two boards shorten to the same word", () => {
    expect(getApi().chipLabel(boards[1], boards)).toBe("CRIMSON PAINTED");
    expect(getApi().chipLabel(boards[2], boards)).toBe("LACQUER 3D");
  });
});
