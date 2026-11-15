import { beforeAll, describe, expect, test } from "bun:test";
import { enforceMjVersion, versionedParams } from "../lib/mj-version";
import { composeMjCommand } from "../lib/mj-queue";
import { composeRecipe } from "../lib/mj-recipe";
import { composeCell } from "../lib/prompt-grid";
import { restyle } from "../lib/locked-prompt";
import { splitCommand } from "../lib/mj-expand";

// Michael, 15 Nov 2026: "never use mj v8.1, do not let it happen". V7 and
// older have been banned since 11 Nov. Every composed job is --v 8.2.

type Twin = { enforceMjVersion: typeof enforceMjVersion; composeMjCommand: typeof composeMjCommand };
const twin = () => (globalThis as typeof globalThis & { SaveToGalleryMjQueueCompose: Twin }).SaveToGalleryMjQueueCompose;

beforeAll(async () => {
  await import("../extension/mj-queue-compose.js");
});

describe("enforceMjVersion", () => {
  const cases: Array<[string, string, string[]]> = [
    ["--ar 16:9 --v 8.1 --raw", "--ar 16:9 --v 8.2 --raw", ["8.1"]],
    ["--version 8.1", "--v 8.2", ["8.1"]],
    ["--V 8.1", "--v 8.2", ["8.1"]],
    ["--v8.1 --hd", "--v 8.2 --hd", ["8.1"]],
    ["—v 8.1", "--v 8.2", ["8.1"]],
    ["--v 7 --stylize 250", "--v 8.2 --stylize 250", ["7"]],
    ["--v 6.1", "--v 8.2", ["6.1"]],
    ["--v 8", "--v 8.2", ["8"]],
    ["--v 8.10", "--v 8.2", ["8.10"]],
    ["--v 8.2 --ar 3:2", "--v 8.2 --ar 3:2", []],
    ["--ar 3:2", "--ar 3:2", []],
    ["--niji 6", "--niji 6", []],
    ["--v 8.1 --ar 3:2 --v 8.2", "--v 8.2 --ar 3:2", ["8.1"]],
    ["", "", []],
  ];
  test.each(cases)("%p → %p", (input, text, replaced) => {
    expect(enforceMjVersion(input)).toEqual({ text, replaced });
  });

  test("words that are not the version flag stay", () => {
    expect(enforceMjVersion("a v8.1 sign on a wall --vibe 3").text).toBe("a v8.1 sign on a wall --vibe 3");
  });

  test("the extension twin rewrites exactly the same", () => {
    for (const [input] of cases) expect(twin().enforceMjVersion(input)).toEqual(enforceMjVersion(input));
  });

  test("versionedParams keeps the version it replaced", () => {
    expect(versionedParams("--ar 3:1 --v 8.1")).toEqual({ params: "--ar 3:1 --v 8.2", replacedVersion: "8.1" });
    expect(versionedParams("--ar 3:1")).toEqual({ params: "--ar 3:1", replacedVersion: undefined });
    expect(versionedParams(undefined)).toEqual({ params: undefined, replacedVersion: undefined });
  });
});

describe("no v8.1 job can be composed", () => {
  test("a queue item with --v 8.1 comes back as --v 8.2 with a warning", () => {
    const item = { prompt: "a quiet harbour at night", profileCodes: ["dfvmdw1"], params: "--ar 16:9 --v 8.1 --stylize 600" };
    const out = composeMjCommand(item);
    expect(out.command).toBe("a quiet harbour at night --profile dfvmdw1 --ar 16:9 --v 8.2 --stylize 600");
    expect(out.command).not.toMatch(/8\.1/);
    expect(out.warnings).toEqual(["v8.1 is not used: switched to v8.2"]);
    expect(twin().composeMjCommand(item)).toEqual(out);
  });

  test("a stored item keeps its warning after its params were rewritten", () => {
    const out = composeMjCommand({ prompt: "a harbour", params: "--v 8.2", replacedVersion: "8.1" });
    expect(out).toEqual({ command: "a harbour --v 8.2", warnings: ["v8.1 is not used: switched to v8.2"] });
  });

  test("style recipes copy as --v 8.2", () => {
    const out = composeRecipe({ parameters: "--raw --stylize 600 --v 8.1", template: "Painted storybook frame. [subject] --v 8.1", profileCodes: ["dfvmdw1"] });
    expect(out.params).toBe("--raw --stylize 600 --v 8.2 --profile dfvmdw1");
    expect(out.prompt).toBe("Painted storybook frame. [subject] --raw --stylize 600 --v 8.2 --profile dfvmdw1");
    expect(out.replacedVersion).toBe("8.1");
  });

  test("a prompt-run cell from a v8.1 preset is --v 8.2", () => {
    const cell = composeCell(
      { text: "a plaza", seed: 1111, imagePrompts: [], extraParams: "--v 7" },
      { variant: { key: "neutral", label: "Neutral", kind: "neutral", text: "a plaza at noon", seeds: [1111] }, seed: 1111 },
      { name: "CAS STORYBOOK · v 8.1", moodboards: [{ code: "dfvmdw1" }], profiles: [], srefs: [], parameters: "--stylize 600 --v 8.1" },
    );
    expect(cell.params).toBe("--stylize 600 --v 8.2 --ar 16:9 --seed 1111");
    expect(cell.replacedVersion).toBe("8.1");
    expect(composeMjCommand(cell).warnings).toContain("v8.1 is not used: switched to v8.2");
  });

  test("a restyle of a locked place is --v 8.2", () => {
    const out = restyle(
      { text: "A wide street at dusk", seed: 42, imagePrompts: [], extraParams: "--v 8.1" },
      { name: "Night storybook", parameters: "--raw --stylize 600", template: "Painted frame. [subject]", moodboardCodes: ["dfvmdw1"], profileCodes: [], unknownCodes: [] },
      "seed",
    );
    expect(out.params).toBe("--raw --stylize 600 --v 8.2 --ar 16:9 --seed 42");
    expect(out.replacedVersion).toBe("8.1");
  });

  test("a grown frame never inherits a retired version", () => {
    expect(splitCommand("a street --ar 3:2 --v 8.1 --profile abc").rest).toBe("--ar 3:2 --v 8.2");
  });
});
