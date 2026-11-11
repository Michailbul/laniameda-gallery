import { beforeAll, describe, expect, test } from "bun:test";

type Board = { name?: string; shortName?: string; mjCode?: string };
type Profile = { name: string; code: string };

type DockApi = {
  groupBoards: (boards: Board[]) => { label: string; boards: Board[] }[];
  orderProfiles: (profiles: Profile[], pins: string[]) => { main: Profile[]; more: Profile[] };
  liveProfiles: (profiles: Profile[]) => Profile[];
  groupOtherProfiles: (
    profiles: (Profile & { worlds?: string[] })[],
    worlds: { key: string; name: string }[],
    currentKey: string,
  ) => { key: string; name: string; profiles: Profile[] }[];
  DEFAULT_PROFILE_PINS: Record<string, string[]>;
  applyMoodboardToPrompt: (
    promptText: string,
    code: string,
    moodboardCodes: string[],
  ) => string;
  chipLabel: (
    board: { name?: string; shortName?: string; mjCode?: string },
    boards: { name?: string; shortName?: string; mjCode?: string }[],
  ) => string;
  toggleProfileInPrompt: (promptText: string, code: string) => string;
  flagCodes: (promptText: string) => string[];
  stickyCodes: (sticky: { board?: string | null; profiles?: string[] } | null, moodboardCodes: string[], profileCodes: string[]) => string[];
  withStickyFlag: (promptText: string, codes: string[]) => string | null;
  setProfileFlag: (promptText: string, codes: string[]) => string;
  readParams: (promptText: string) => string;
  setParams: (promptText: string, paramsText: string) => string;
  removeParams: (promptText: string, paramsText: string) => string;
  hasParams: (promptText: string, paramsText: string) => boolean;
  snapshotImages: (board: {
    previews?: { thumbUrl?: string; url?: string }[];
    thumbUrl?: string | null;
  }) => string[];
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

describe("snapshotImages", () => {
  test("uses the full image, then the thumb, with no repeats", () => {
    expect(
      getApi().snapshotImages({
        previews: [
          { thumbUrl: "a", url: "A" },
          { url: "b" },
          { thumbUrl: "A" },
        ],
      }),
    ).toEqual(["A", "b"]);
  });

  test("falls back to thumbUrl for older responses", () => {
    expect(getApi().snapshotImages({ thumbUrl: "t" })).toEqual(["t"]);
  });

  test("empty when the board has no pictures", () => {
    expect(getApi().snapshotImages({ previews: [], thumbUrl: null })).toEqual([]);
  });
});

describe("toggleProfileInPrompt", () => {
  const toggle = (prompt: string, code: string) => getApi().toggleProfileInPrompt(prompt, code);

  test("adds a profile flag to a prompt that has none", () => {
    expect(toggle("a tram at dusk", "h2eu2z6")).toBe("a tram at dusk -p h2eu2z6");
    expect(toggle("", "h2eu2z6")).toBe("-p h2eu2z6");
  });

  test("stacks a profile after the moodboard code and keeps every other flag", () => {
    expect(toggle("a tram --ar 16:9 -p 88ji6bg --s 600", "h2eu2z6")).toBe("a tram --ar 16:9 -p 88ji6bg h2eu2z6 --s 600");
  });

  test("removes the profile when it is already in the flag", () => {
    expect(toggle("a tram -p 88ji6bg h2eu2z6 --s 600", "h2eu2z6")).toBe("a tram -p 88ji6bg --s 600");
  });

  test("drops the flag when the profile was its only code", () => {
    expect(toggle("a tram -p h2eu2z6 --s 600", "h2eu2z6")).toBe("a tram --s 600");
  });

  test("merges split profile flags into one", () => {
    expect(toggle("a tram --profile 88ji6bg --s 600 -p 9ts8jmb", "h2eu2z6")).toBe("a tram -p 88ji6bg 9ts8jmb h2eu2z6 --s 600");
  });

  test("a moodboard switch keeps the profile that was added", () => {
    const withProfile = toggle("a tram -p 88ji6bg", "h2eu2z6");
    expect(apply(withProfile, "gms8ial")).toBe("a tram -p gms8ial h2eu2z6");
  });

  test("flagCodes lists every code in every profile flag", () => {
    expect(getApi().flagCodes("x -p 88ji6bg h2eu2z6 --s 6 --profile 9ts8jmb")).toEqual(["88ji6bg", "h2eu2z6", "9ts8jmb"]);
  });
});

describe("sticky selection", () => {
  const api = () => getApi();

  test("the board comes first, then the profiles, only while they exist", () => {
    expect(api().stickyCodes({ board: "88ji6bg", profiles: ["h2eu2z6", "gone123"] }, CODES, ["h2eu2z6", "9ts8jmb"])).toEqual(["88ji6bg", "h2eu2z6"]);
    expect(api().stickyCodes({ board: "oldcode", profiles: [] }, CODES, [])).toEqual([]);
    expect(api().stickyCodes(null, CODES, [])).toEqual([]);
  });

  test("a new prompt gets the remembered flag at its end", () => {
    expect(api().withStickyFlag("a tram at dusk ", ["88ji6bg", "h2eu2z6"])).toBe("a tram at dusk -p 88ji6bg h2eu2z6");
  });

  test("a prompt that already has a flag, or no words, is left alone", () => {
    expect(api().withStickyFlag("a tram -p 5no6b1c", ["88ji6bg"])).toBeNull();
    expect(api().withStickyFlag("   ", ["88ji6bg"])).toBeNull();
    expect(api().withStickyFlag("a tram", [])).toBeNull();
  });
});

describe("presets", () => {
  const prompt = "A tram at dawn --sref https://cdn.example/a.png --ar 3:2 --stylize 100 -p m7a1 p2 --raw";

  test("setProfileFlag puts exactly the preset's codes in one flag", () => {
    expect(getApi().setProfileFlag(prompt, ["m7a3", "p3"])).toBe(
      "A tram at dawn --sref https://cdn.example/a.png --ar 3:2 --stylize 100 -p m7a3 p3 --raw",
    );
    expect(getApi().setProfileFlag("A tram -p a -p b", ["c"])).toBe("A tram -p c");
    expect(getApi().setProfileFlag("A tram", ["c", "d"])).toBe("A tram -p c d");
  });

  test("setProfileFlag with no codes drops the flag", () => {
    expect(getApi().setProfileFlag(prompt, [])).toBe(
      "A tram at dawn --sref https://cdn.example/a.png --ar 3:2 --stylize 100 --raw",
    );
  });

  test("readParams keeps settings and skips image references and the profile flag", () => {
    expect(getApi().readParams(prompt)).toBe("--ar 3:2 --stylize 100 --raw");
    expect(getApi().readParams("A tram --seed 42 --v 8.2 --chaos 10")).toBe("--v 8.2 --chaos 10");
  });

  test("setParams replaces the same setting under its short or long name", () => {
    expect(getApi().setParams(prompt, "--ar 16:9 --s 250")).toBe(
      "A tram at dawn --sref https://cdn.example/a.png -p m7a1 p2 --raw --ar 16:9 --s 250",
    );
    expect(getApi().setParams("", "--ar 16:9")).toBe("--ar 16:9");
    expect(getApi().setParams("A tram --sref https://x/a.png", "--s 50")).toBe("A tram --sref https://x/a.png --s 50");
  });

  test("hasParams compares values across short and long names", () => {
    const withPreset = getApi().setParams(prompt, "--ar 16:9 --s 250");
    expect(getApi().hasParams(withPreset, "--ar 16:9 --stylize 250")).toBe(true);
    expect(getApi().hasParams(prompt, "--ar 16:9")).toBe(false);
    expect(getApi().hasParams(prompt, "--raw")).toBe(true);
  });

  test("removeParams takes out only the preset's own values", () => {
    const withPreset = getApi().setParams(prompt, "--ar 16:9 --s 250");
    expect(getApi().removeParams(withPreset, "--ar 16:9 --s 250")).toBe(
      "A tram at dawn --sref https://cdn.example/a.png -p m7a1 p2 --raw",
    );
    expect(getApi().removeParams("A tram --ar 2:3", "--ar 16:9")).toBe("A tram --ar 2:3");
  });
});

describe("board families and main profiles", () => {
  const board = (name: string) => ({ name, mjCode: name });
  const names = (list: Board[]) => list.map((entry) => entry.name);

  test("a world with many boards shows them by family, singles under More", () => {
    const boards = [
      ...["Couture", "Crimson Valley", "Faces", "Golden", "World"].map((n) => board(`DA FILM \u00b7 ${n}`)),
      ...["Candle", "Night Dread", "Red Dread"].map((n) => board(`DA HALLOWEEN \u00b7 ${n}`)),
      board("Light-Beauty"),
      board("STYLE \u00b7 Lone"),
    ];
    const groups = getApi().groupBoards(boards);
    expect(groups.map((group) => group.label)).toEqual(["FILM", "HALLOWEEN", "MORE"]);
    expect(names(groups[2].boards)).toEqual(["Light-Beauty", "STYLE \u00b7 Lone"]);
  });

  test("a small world is one line without a label", () => {
    const boards = ["ART DECOcity", "DA DECO \u00b7 Daylight", "DA DECO \u00b7 World", "STYLE \u00b7 Anim"].map(board);
    expect(getApi().groupBoards(boards)).toEqual([{ label: "", boards }]);
    expect(getApi().groupBoards([])).toEqual([]);
  });

  test("Dear Annete's main profiles come first in Michael's order, the rest after", () => {
    const profiles = ["ANIM", "CINEMATIC", "DA 5", "DA V3", "DA v8", "DA v8.2", "DA4", "DEAR ANNETTE 2", "LOCATIONS", "LOVE"].map(
      (name) => ({ name, code: name.toLowerCase() }),
    );
    const { main, more } = getApi().orderProfiles(profiles, getApi().DEFAULT_PROFILE_PINS["dear-annete"]);
    expect(main.map((p) => p.name)).toEqual(["DA4", "DA 5", "DA V3", "DA v8.2", "DEAR ANNETTE 2", "CINEMATIC", "LOCATIONS"]);
    expect(more.map((p) => p.name)).toEqual(["ANIM", "DA v8", "LOVE"]);
  });

  test("without a matching pin every profile is main", () => {
    const profiles = [{ name: "ANIM", code: "a" }, { name: "DARI", code: "d" }];
    expect(getApi().orderProfiles(profiles, [])).toEqual({ main: profiles, more: [] });
    expect(getApi().orderProfiles(profiles, ["nothing"])).toEqual({ main: profiles, more: [] });
  });
});

describe("other worlds' profiles", () => {
  test("deleted profiles never show", () => {
    const list = [{ name: "CAS COAST (deleted in MJ)", code: "a" }, { name: "CAS Main 1", code: "b" }, { name: "x", code: "" }];
    expect(getApi().liveProfiles(list)).toEqual([{ name: "CAS Main 1", code: "b" }]);
  });

  test("one line per other world in world order, unused profiles last, the current world left out", () => {
    const worlds = [
      { key: "dear-annete", name: "DEAR ANNETE" },
      { key: "cassandra", name: "CASSANDRA" },
      { key: "andromeda-anya", name: "ANDROMEDA" },
    ];
    const profiles = [
      { name: "DA4", code: "d4", worlds: ["dear-annete"] },
      { name: "CAS Main 1", code: "c1", worlds: ["cassandra"] },
      { name: "GLOBAL", code: "g", worlds: [] },
      { name: "CAS GIRL (deleted in MJ)", code: "dg", worlds: ["cassandra"] },
    ];
    const lines = getApi().groupOtherProfiles(profiles, worlds, "cassandra");
    expect(lines.map((line) => [line.key, line.profiles.map((p) => p.name)])).toEqual([
      ["dear-annete", ["DA4"]],
      ["", ["GLOBAL"]],
    ]);
  });
});
