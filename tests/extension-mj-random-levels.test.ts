import { describe, expect, test } from "bun:test";
import "../extension/mj-randomize.js";
import "../extension/mj-rerun.js";

type Mix = { profiles: string[]; boards: string[]; codes: string[]; locked?: string[] };
type Settings = { level: string; locks: Record<string, string[]> };
const g = globalThis as unknown as {
  SaveToGalleryRandomize: {
    LEVELS: Array<{ key: string; label: string }>;
    levelOf(key: unknown): string;
    nextLevel(key: string): string;
    randomSettings(stored: unknown): Settings;
    locksOf(settings: Settings, world: string): string[];
    withLocks(settings: Settings, world: string, codes: string[]): Settings;
    mixAt(pool: object, options: object): Mix;
    randomSet(pool: object, count: number, mode: string, options?: object): Array<{ codes: string[] }>;
    codesIn(prompt: string): string[];
  };
  SaveToGalleryMjRerun: { rerunCommand(input: object): { command: string; mix: Mix } };
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
const pool = { profiles: ["p1", "p2", "p3", "p4", "n9iqix8"], boards: ["m1", "m2", "m3"], names: {} };

describe("random levels: MB · P · MB+P · WILD, one click cycles", () => {
  test("the levels and the cycle", () => {
    expect(R.LEVELS.map((l) => l.label)).toEqual(["MB", "P", "MB+P", "WILD"]);
    expect(["mb", "p", "mix", "wild"].map(R.nextLevel)).toEqual(["p", "mix", "wild", "mb"]);
    expect(R.levelOf("nonsense")).toBe("mix");
  });

  test("MB: one random moodboard, the prompt's own profiles stay", () => {
    const rng = seeded(1);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const mix = R.mixAt(pool, { level: "mb", current: ["p2", "p3", "m1"], rng });
      expect(mix.profiles).toEqual(["p2", "p3"]);
      expect(mix.boards.length).toBe(1);
      seen.add(mix.boards[0]!);
    }
    expect(seen.size).toBe(3);
  });

  test("P: 1–2 random profiles, the prompt's own moodboard stays", () => {
    const rng = seeded(2);
    for (let i = 0; i < 100; i += 1) {
      const mix = R.mixAt(pool, { level: "p", current: ["m2", "p1"], rng });
      expect(mix.boards).toEqual(["m2"]);
      expect(mix.profiles.length).toBeGreaterThanOrEqual(1);
      expect(mix.profiles.length).toBeLessThanOrEqual(2);
      expect(mix.codes).not.toContain("n9iqix8");
    }
  });

  test("WILD reaches 3 profiles and 2 moodboards; MB+P stays at 1 moodboard", () => {
    const rng = seeded(3);
    let three = false, two = false;
    for (let i = 0; i < 300; i += 1) {
      const wild = R.mixAt(pool, { level: "wild", rng });
      expect(wild.profiles.length).toBeLessThanOrEqual(3);
      expect(wild.boards.length).toBeLessThanOrEqual(2);
      three ||= wild.profiles.length === 3;
      two ||= wild.boards.length === 2;
      expect(R.mixAt(pool, { level: "mix", rng }).boards.length).toBe(1);
    }
    expect(three && two).toBe(true);
  });
});

describe("locks: locked codes ride in every mix, the rest is random", () => {
  test("a locked profile stays at every level while moodboards change", () => {
    const rng = seeded(4);
    for (const level of ["mb", "p", "mix", "wild"]) {
      for (let i = 0; i < 40; i += 1) {
        const mix = R.mixAt(pool, { level, locks: ["p1"], current: ["p4", "m3"], rng });
        expect(mix.profiles).toContain("p1");
        if (level === "mb") expect(mix.profiles).toEqual(["p1"]);
      }
    }
  });

  test("a locked moodboard stays; MB adds nothing on top of it", () => {
    const mix = R.mixAt(pool, { level: "mb", locks: ["m2", "p1"], rng: seeded(5) });
    expect(mix.boards).toEqual(["m2"]);
    expect(mix.profiles).toEqual(["p1"]);
  });

  test("settings: locks per world, unlock with an empty list", () => {
    let settings = R.randomSettings(null);
    expect(settings).toEqual({ level: "mix", locks: {} });
    settings = R.withLocks(settings, "dear-annete", ["p1", "m1", "n9iqix8"]);
    expect(R.locksOf(settings, "dear-annete")).toEqual(["p1", "m1"]);
    expect(R.locksOf(settings, "andromeda")).toEqual([]);
    expect(R.locksOf(R.withLocks(settings, "dear-annete", []), "dear-annete")).toEqual([]);
  });

  test("queue Random keeps the locks in every variant", () => {
    for (const variant of R.randomSet(pool, 5, "random", { locks: ["p2"], rng: seeded(6) })) expect(variant.codes).toContain("p2");
  });

  test("Rerun puts the locked profile and a new moodboard in the bar", () => {
    const out = X.rerunCommand({
      command: "a lighthouse at dusk --ar 16:9 --profile p3 m1 --v 8.1", pool, srefs: [], level: "mb", locks: ["p1"], R, rng: seeded(7),
    });
    expect(R.codesIn(out.command)).toContain("p1");
    expect(out.mix.profiles).toEqual(["p1"]);
    expect(out.mix.boards.length).toBe(1);
    expect(out.command).toContain("--v 8.2");
  });
});
