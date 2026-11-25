import { beforeAll, describe, expect, test } from "bun:test";
import { composeMjCommand, pinnedVersion, threadIdOf, MJ_THREAD_ID, type MjQueueComposable } from "../lib/mj-queue";

type ComposeApi = {
  composeMjCommand: (item: MjQueueComposable) => { command: string; warnings: string[] };
  pinnedVersion: (params: string) => string;
  sameCommand: (a: string, b: string) => boolean;
  threadIdOf: (batchKey: string) => string;
};
const twin = () => (globalThis as typeof globalThis & { SaveToGalleryMjQueueCompose: ComposeApi }).SaveToGalleryMjQueueCompose;

beforeAll(async () => {
  await import("../extension/mj-queue-compose.js");
});

const R2 = "https://media.laniameda.space/assets";
const fixtures: Record<string, MjQueueComposable> = {
  full: {
    prompt: "  The name Annete written\nby hand in iron-gall ink ",
    imagePrompts: [{ url: `${R2}/a.jpg`, weight: 0.5 }, { url: `${R2}/b.jpg` }],
    styleRefs: [{ url: `${R2}/fleur.jpg`, weight: 2 }, { code: "3534013297" }, { url: `${R2}/current.jpg` }],
    profileCodes: ["vtrctg9", "vtrctg9", "88ji6bg"],
    params: "--ar 3:1 --draft --relax",
  },
  proseOnly: { prompt: "a rose window", params: "" },
  omniV82: { prompt: "a clawed blackletter A", omniRef: { url: `${R2}/claw.jpg`, weight: 120 }, params: "--ar 3:1" },
  omniV7: { prompt: "a clawed blackletter A", omniRef: { url: `${R2}/claw.jpg`, weight: 120 }, params: "--v 7 --ar 3:1" },
  crefV6: { prompt: "a portrait", characterRef: { url: `${R2}/face.jpg` }, params: "--v 6.1" },
  crefNiji: { prompt: "a portrait", characterRef: { url: `${R2}/face.jpg` }, params: "--niji 6" },
  empty: { prompt: "  " },
  restyleFrame: { prompt: "a school patio, wide shot", profileCodes: ["dfvmdw1"], params: "--raw --ar 16:9 --seed 42", editRefs: [{ url: "https://cdn.midjourney.com/1c8e8ead-03c5-47ec-9ac0-5e9472ee466a/0_2.png" }] },
  editV7: { prompt: "a patio", params: "--v 7", editRefs: [{ url: `${R2}/frame.jpg` }] },
  niji: { prompt: "a fox", params: "--niji 6 --ar 2:3", profileCodes: ["n9iqix8", "abc"] },
  niji8: { prompt: "a beach town", params: "--niji 8 --stylize 600 --ar 16:9", profileCodes: ["dfvmdw1"] },
  niji8WithV: { prompt: "a beach town", params: "--v 8.2 --niji 8 --ar 16:9" },
  niji8Profiles: {
    prompt: "a beach town", params: "--profile xeyqml8 37vd7r6 --niji 8 --raw --ar 16:9",
    profileCodes: ["e6pj8eo", "2k7kjkp"], v8OnlyCodes: ["2k7kjkp", "37vd7r6"],
  },
  v82Profiles: { prompt: "a beach town", params: "--v 8.2 --ar 16:9", profileCodes: ["e6pj8eo", "2k7kjkp"], v8OnlyCodes: ["2k7kjkp"] },
  bannedParams: { prompt: "a fox", params: "--profile n9iqix8 --ar 1:1" },
};

describe("composeMjCommand", () => {
  test("image prompts first, then prose, srefs, --iw, profile, params", () => {
    expect(composeMjCommand(fixtures.full).command).toBe(
      `${R2}/a.jpg ${R2}/b.jpg The name Annete written by hand in iron-gall ink --sref ${R2}/fleur.jpg::2 3534013297 ${R2}/current.jpg --iw 0.5 --profile vtrctg9 88ji6bg --ar 3:1 --draft --relax`,
    );
    expect(composeMjCommand(fixtures.full).warnings).toEqual([]);
  });

  test("V8.2 leaves omni and character references out with a warning", () => {
    const omni = composeMjCommand(fixtures.omniV82);
    expect(omni.command).toBe("a clawed blackletter A --ar 3:1");
    expect(omni.warnings[0]).toContain("Omni reference left out");
    expect(omni.warnings[0]).not.toContain("--v 7");
    // A pinned V7 or V6 is moved to V8.2, so --oref and --cref never come back.
    const v7 = composeMjCommand(fixtures.omniV7);
    expect(v7.command).toBe("a clawed blackletter A --v 8.2 --ar 3:1");
    expect(v7.warnings).toEqual(["v7 is not used: switched to v8.2", "Omni reference left out: V8.2 has none. Attach the picture for the Edit model instead."]);
    const v6 = composeMjCommand(fixtures.crefV6);
    expect(v6.command).toBe("a portrait --v 8.2");
    expect(v6.warnings).toContain("v6.1 is not used: switched to v8.2");
    // Niji is not used either: --niji 6 becomes --v 8.2, so --cref never comes back.
    const niji = composeMjCommand(fixtures.crefNiji);
    expect(niji.command).toBe("a portrait --v 8.2");
    expect(niji.warnings).toEqual(["niji 6 is not used: switched to v8.2", "Character reference left out: V8.2 has none. Attach the picture for the Edit model instead."]);
  });

  test("--niji becomes --v 8.2 and keeps the other params", () => {
    expect(composeMjCommand({ prompt: "a fox", params: "--niji --ar 2:3" })).toEqual({ command: "a fox --ar 2:3 --v 8.2", warnings: ["niji is not used: switched to v8.2"] });
    expect(composeMjCommand({ prompt: "a fox", params: "--v 8.2 —niji 7 --raw" }).command).toBe("a fox --v 8.2 --raw");
  });

  test("--niji 8 and later stay as written; a --v next to it is dropped", () => {
    expect(composeMjCommand(fixtures.niji8)).toEqual({ command: "a beach town --profile dfvmdw1 --niji 8 --stylize 600 --ar 16:9", warnings: [] });
    expect(composeMjCommand(fixtures.niji8WithV)).toEqual({ command: "a beach town --niji 8 --ar 16:9", warnings: [] });
    expect(composeMjCommand({ prompt: "a fox", params: "—niji 8.1 --raw" }).command).toBe("a fox --niji 8.1 --raw");
    expect(composeMjCommand({ prompt: "a fox", params: "--niji 9" }).command).toBe("a fox --niji 9");
    expect(pinnedVersion("--niji 8 --ar 16:9")).toBe("niji 8");
  });

  test("a Niji job leaves personal profiles out and keeps moodboards; V8.2 keeps them", () => {
    expect(composeMjCommand(fixtures.niji8Profiles)).toEqual({
      command: "a beach town --profile e6pj8eo --profile xeyqml8 --niji 8 --raw --ar 16:9",
      warnings: ["Personal profile 37vd7r6 2k7kjkp left out: Niji takes moodboards only (personal profiles are V8-only)."],
    });
    expect(composeMjCommand({ prompt: "a fox", params: "--niji 8", profileCodes: ["2k7kjkp"], v8OnlyCodes: ["2k7kjkp"] }).command).toBe("a fox --niji 8");
    expect(composeMjCommand(fixtures.v82Profiles)).toEqual({ command: "a beach town --profile e6pj8eo 2k7kjkp --v 8.2 --ar 16:9", warnings: [] });
  });

  test("the AndromedaCartoon profile never reaches a command", () => {
    const codes = composeMjCommand({ prompt: "a fox", profileCodes: ["n9iqix8", "vtrctg9"], params: "--ar 1:1" });
    expect(codes.command).toBe("a fox --profile vtrctg9 --ar 1:1");
    expect(codes.warnings).toEqual(["AndromedaCartoon profile left out: it is never used."]);
    const inParams = composeMjCommand({ prompt: "a fox", params: "--p n9iqix8 --ar 1:1" });
    expect(inParams.command).toBe("a fox --ar 1:1");
    expect(inParams.warnings.length).toBe(1);
    expect(composeMjCommand({ prompt: "a fox --profile n9iqix8 abc123" }).command).toBe("a fox --profile abc123");
  });

  test("an empty item warns", () => {
    expect(composeMjCommand(fixtures.empty)).toEqual({ command: "", warnings: ["No prompt words yet."] });
  });

  test("the extension twin composes exactly the same", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      expect({ name, ...twin().composeMjCommand(fixture) }).toEqual({ name, ...composeMjCommand(fixture) });
    }
    for (const params of ["--v 7", "--version 6.1 --ar 1:1", "--niji 6", "--niji", "--niji 8", "--ar 3:1"]) {
      expect(twin().pinnedVersion(params)).toBe(pinnedVersion(params));
    }
    expect(twin().sameCommand("a  b --ar 3:1 ", "a b --ar 3:1")).toBe(true);
  });
});

describe("thread ids", () => {
  const labels = ["Dear Annete · the monster's hand · round 2", "  DEAR ANNETE ·  the monster's hand · round 2 ", "Andromeda · Anya — wardrobe ✦", ""];
  test("the gallery and the extension give the same id, stable across case and spacing", () => {
    for (const label of labels) {
      expect(twin().threadIdOf(label)).toBe(threadIdOf(label));
      expect(threadIdOf(label)).toMatch(MJ_THREAD_ID);
    }
    expect(threadIdOf(labels[0])).toBe(threadIdOf(labels[1]));
    expect(threadIdOf(labels[0])).not.toBe(threadIdOf("Dear Annete · the monster's hand · round 1"));
  });
});

describe("edit attachments", () => {
  test("--edit goes last and only for V8.2", () => {
    expect(composeMjCommand(fixtures.restyleFrame).command).toBe(
      "a school patio, wide shot --profile dfvmdw1 --raw --ar 16:9 --seed 42 --edit https://cdn.midjourney.com/1c8e8ead-03c5-47ec-9ac0-5e9472ee466a/0_2.png",
    );
    // --v 7 is rewritten to --v 8.2, so the attached frame is kept.
    const v7 = composeMjCommand(fixtures.editV7);
    expect(v7.command).toBe(`a patio --v 8.2 --edit ${R2}/frame.jpg`);
    expect(v7.warnings).toEqual(["v7 is not used: switched to v8.2"]);
    // --niji is switched to --v 8.2, so the frame is kept there too.
    const niji = composeMjCommand({ prompt: "a patio", params: "--niji 7", editRefs: [{ url: `${R2}/frame.jpg` }] });
    expect(niji.command).toBe(`a patio --v 8.2 --edit ${R2}/frame.jpg`);
    expect(niji.warnings).toEqual(["niji 7 is not used: switched to v8.2"]);
  });
});
