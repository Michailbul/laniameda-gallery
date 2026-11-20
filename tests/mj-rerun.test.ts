import { describe, expect, test } from "bun:test";
import "../extension/mj-randomize.js";
import "../extension/mj-rerun.js";

type Mix = { profiles: string[]; boards: string[]; codes: string[] };
const g = globalThis as unknown as {
  SaveToGalleryRandomize: {
    rerunMix(pool: object, options?: object): Mix;
    withSref(prompt: string, mode: string): string;
    srefsIn(prompt: string): string[];
    codesIn(prompt: string): string[];
  };
  SaveToGalleryMjRerun: {
    isChipText(text: string): boolean;
    onCurrentVersion(command: string): string;
    rerunCommand(input: object): { command: string; mix: Mix; sref: { code: string; label?: string } | null };
  };
};
const R = g.SaveToGalleryRandomize;
const X = g.SaveToGalleryMjRerun;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pool = { profiles: ["aaa1", "bbb2", "ccc3", "n9iqix8"], boards: ["m111", "m222"], names: {} };

describe("Rerun random on a Midjourney job", () => {
  test("1–2 profiles, exactly one moodboard when on, none when off, never AndromedaCartoon", () => {
    const rng = seeded(7);
    for (let i = 0; i < 200; i += 1) {
      const on = R.rerunMix(pool, { moodboard: true, rng });
      expect(on.profiles.length).toBeGreaterThanOrEqual(1);
      expect(on.profiles.length).toBeLessThanOrEqual(2);
      expect(on.boards.length).toBe(1);
      expect(on.codes).not.toContain("n9iqix8");
      expect(R.rerunMix(pool, { moodboard: false, rng }).boards.length).toBe(0);
    }
  });

  test("sref: keep, none, or replace; --sw stays", () => {
    const cmd = "a fox --ar 16:9 --sref 123 456 --sw 200 --raw";
    expect(R.withSref(cmd, "keep")).toBe(cmd);
    expect(R.srefsIn(R.withSref(cmd, "none"))).toEqual([]);
    expect(R.withSref(cmd, "none")).toContain("--sw 200");
    expect(R.srefsIn(R.withSref(cmd, "777"))).toEqual(["777"]);
  });

  test("an older --v becomes 8.2; 8.2 and niji stay", () => {
    expect(X.onCurrentVersion("a --v 8.1 --ar 1:1")).toBe("a --v 8.2 --ar 1:1");
    expect(X.onCurrentVersion("a --version 7")).toBe("a --v 8.2");
    expect(X.onCurrentVersion("a --v 8.2")).toBe("a --v 8.2");
    expect(X.onCurrentVersion("a --niji 6")).toBe("a --niji 6");
  });

  test("the rerun command swaps the profile mix and keeps the words and image prompts", () => {
    const command = "https://s.mj.run/abc a lonely lighthouse --chaos 35 --ar 16:9 --profile GLOBAL --sref 999 --v 8.1";
    const out = X.rerunCommand({ command, pool, srefs: [{ code: "3141592", label: "Velvet noir" }], moodboard: true, sref: "random", R, rng: seeded(3) });
    expect(out.command.startsWith("https://s.mj.run/abc a lonely lighthouse")).toBe(true);
    expect(R.codesIn(out.command)).toEqual(out.mix.codes);
    expect(R.codesIn(out.command)).not.toContain("GLOBAL");
    expect(R.srefsIn(out.command)).toEqual(["3141592"]);
    expect(out.command).toContain("--v 8.2");
    expect(out.command).toContain("--chaos 35");
  });

  test("random sref with none in the world keeps the job's own", () => {
    const out = X.rerunCommand({ command: "a --sref 999", pool, srefs: [], sref: "random", R, rng: seeded(1) });
    expect(R.srefsIn(out.command)).toEqual(["999"]);
    expect(out.sref).toBeNull();
  });

  test("chip texts", () => {
    for (const text of ["ar 16:9", "chaos 35", "raw", "hd", "profile GLOBAL", "stylize 250", "sref 123"]) expect(X.isChipText(text)).toBe(true);
    for (const text of ["Flat animation illustration", "Thinking", "", "a".repeat(50)]) expect(X.isChipText(text)).toBe(false);
  });
});
