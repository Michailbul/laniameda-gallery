import { beforeAll, describe, expect, test } from "bun:test";
import { composeMjCommand, pinnedVersion, type MjQueueComposable } from "../lib/mj-queue";

type ComposeApi = {
  composeMjCommand: (item: MjQueueComposable) => { command: string; warnings: string[] };
  pinnedVersion: (params: string) => string;
  sameCommand: (a: string, b: string) => boolean;
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
    expect(composeMjCommand(fixtures.omniV7).command).toBe(`a clawed blackletter A --oref ${R2}/claw.jpg --ow 120 --v 7 --ar 3:1`);
    expect(composeMjCommand(fixtures.crefV6).command).toBe(`a portrait --cref ${R2}/face.jpg --v 6.1`);
    expect(composeMjCommand(fixtures.crefNiji).command).toBe(`a portrait --cref ${R2}/face.jpg --niji 6`);
  });

  test("an empty item warns", () => {
    expect(composeMjCommand(fixtures.empty)).toEqual({ command: "", warnings: ["No prompt words yet."] });
  });

  test("the extension twin composes exactly the same", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      expect({ name, ...twin().composeMjCommand(fixture) }).toEqual({ name, ...composeMjCommand(fixture) });
    }
    for (const params of ["--v 7", "--version 6.1 --ar 1:1", "--niji 6", "--niji", "--ar 3:1"]) {
      expect(twin().pinnedVersion(params)).toBe(pinnedVersion(params));
    }
    expect(twin().sameCommand("a  b --ar 3:1 ", "a b --ar 3:1")).toBe(true);
  });
});
