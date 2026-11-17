import { describe, expect, test } from "bun:test";
import "../extension/mj-randomize.js";

type Mix = { label: string; codes: string[]; profiles?: string[]; boards?: string[] };
type Randomize = {
  pickMix(pool: object, mode: string, options?: object): { profiles: string[]; boards: string[]; codes: string[] };
  signature(codes: string[]): string;
  withCodes(prompt: string, codes: string[]): string;
  testSet(pool: object, options?: object): Mix[];
  randomSet(pool: object, count: number, mode: string, options?: object): Mix[];
};
const R = (globalThis as unknown as { SaveToGalleryRandomize: Randomize }).SaveToGalleryRandomize;

// Deterministic generator so the limits are checked over many draws.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pool = { profiles: ["p1", "p2", "p3", "p4", "n9iqix8"], boards: ["m1", "m2", "m3"], names: { p1: "CINEMATIC", m1: "Night" } };

describe("pickMix", () => {
  test("random: 1–2 profiles, at most 1 moodboard, never AndromedaCartoon", () => {
    const rng = seeded(1);
    for (let i = 0; i < 400; i += 1) {
      const mix = R.pickMix(pool, "random", { rng });
      expect(mix.profiles.length).toBeGreaterThanOrEqual(1);
      expect(mix.profiles.length).toBeLessThanOrEqual(2);
      expect(mix.boards.length).toBeLessThanOrEqual(1);
      expect(mix.codes).not.toContain("n9iqix8");
    }
  });

  test("extreme: 1–3 profiles, at most 2 moodboards", () => {
    const rng = seeded(2);
    let sawThree = false;
    let sawTwoBoards = false;
    for (let i = 0; i < 400; i += 1) {
      const mix = R.pickMix(pool, "extreme", { rng });
      expect(mix.profiles.length).toBeLessThanOrEqual(3);
      expect(mix.boards.length).toBeLessThanOrEqual(2);
      sawThree ||= mix.profiles.length === 3;
      sawTwoBoards ||= mix.boards.length === 2;
    }
    expect(sawThree).toBe(true);
    expect(sawTwoBoards).toBe(true);
  });

  test("a reroll avoids the current mix when the pool allows", () => {
    const rng = seeded(3);
    const small = { profiles: ["a", "b"], boards: [] };
    for (let i = 0; i < 50; i += 1) {
      const first = R.pickMix(small, "random", { rng });
      const next = R.pickMix(small, "random", { rng, avoid: R.signature(first.codes) });
      expect(R.signature(next.codes)).not.toBe(R.signature(first.codes));
    }
  });
});

describe("withCodes", () => {
  test("replaces every profile flag and keeps words and params", () => {
    expect(R.withCodes("a dark hall --p x y --ar 16:9 --s 750", ["z"])).toBe("a dark hall --profile z --ar 16:9 --s 750");
    expect(R.withCodes("a dark hall -p x --ar 16:9 --profile q", ["z", "w"])).toBe("a dark hall --profile z w --ar 16:9");
  });

  test("an empty list removes the flag", () => {
    expect(R.withCodes("a hall --profile x --v 8.2", [])).toBe("a hall --v 8.2");
  });

  test("a prompt with no params gets the flag at the end", () => {
    expect(R.withCodes("a hall", ["q"])).toBe("a hall --profile q");
  });

  test("never writes AndromedaCartoon", () => {
    expect(R.withCodes("a hall", ["n9iqix8", "q"])).toBe("a hall --profile q");
  });
});

describe("sets", () => {
  test("test set: no profile first, then each profile alone", () => {
    const set = R.testSet(pool);
    expect(set[0]).toEqual({ label: "No profile", codes: [] });
    expect(set.slice(1).map((entry) => entry.codes)).toEqual([["p1"], ["p2"], ["p3"], ["p4"]]);
    expect(set[1].label).toBe("CINEMATIC");
  });

  test("random set gives distinct mixes", () => {
    const set = R.randomSet(pool, 6, "random", { rng: seeded(4) });
    expect(set.length).toBe(6);
    expect(new Set(set.map((entry) => R.signature(entry.codes))).size).toBe(6);
  });
});
