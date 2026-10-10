import { describe, expect, test } from "bun:test";
import { parseStorybookMeta, splitStorybookName } from "../lib/storybook-meta";

const notReady = `TWO SANDWICHES · about 40 seconds · chiseled-painted-cinematic (animation)
NOT READY: 3 blocking gaps

STORY
1. A gust lifts the paper wrapper of the second sandwich on a picnic blanket.
2. She folds the paper around it.`;

describe("splitStorybookName", () => {
  test("splits on the last middle dot", () => {
    expect(splitStorybookName("ANDROMEDA — ANYA · One Grain a Day")).toEqual({
      world: "ANDROMEDA — ANYA",
      title: "One Grain a Day",
      archived: false,
    });
  });
  test("falls back to an em dash, then to the whole name", () => {
    expect(splitStorybookName("ORPHEUS — Storybook").world).toBe("ORPHEUS");
    expect(splitStorybookName("VAMPIRE DIARIES")).toEqual({
      world: "VAMPIRE DIARIES",
      title: "VAMPIRE DIARIES",
      archived: false,
    });
  });
  test("strips the archived prefix and flags it", () => {
    const parts = splitStorybookName("ARCHIVED · DADDY ISSUES · The Top Button");
    expect(parts.archived).toBe(true);
    expect(parts.world).toBe("DADDY ISSUES");
    expect(parts.title).toBe("The Top Button");
  });
});

describe("parseStorybookMeta", () => {
  test("reads status, gaps, runtime, medium and hook from a production header", () => {
    const meta = parseStorybookMeta("ANDROMEDA — ANYA · Two Sandwiches", notReady);
    expect(meta.status).toBe("not-ready");
    expect(meta.gaps).toBe(3);
    expect(meta.runtimeSeconds).toBe(40);
    expect(meta.medium).toBe("animated");
    expect(meta.hook).toBe(
      "A gust lifts the paper wrapper of the second sandwich on a picnic blanket.",
    );
  });
  test("a READY line reads as ready with no gap count", () => {
    const meta = parseStorybookMeta(
      "DEAR ANNETE · X",
      "X · about 30 seconds · golden-prague-ue (live action)\nREADY\n\nSTORY\n1. Go.",
    );
    expect(meta.status).toBe("ready");
    expect(meta.gaps).toBeNull();
    expect(meta.medium).toBe("live-action");
  });
  test("legacy text without a status line is unreviewed", () => {
    const meta = parseStorybookMeta(
      "DEAR ANNETE · Lens Cap",
      "Revised story draft · 30–45 seconds\nOn a palace balcony, Liz offers bread.",
    );
    expect(meta.status).toBe("unreviewed");
    expect(meta.runtimeSeconds).toBe(45);
    expect(meta.medium).toBeNull();
  });
  test("archived wins over any status line", () => {
    expect(
      parseStorybookMeta("ARCHIVED · DADDY · The Top Button", "READY").status,
    ).toBe("archived");
  });
  test("empty story text is safe", () => {
    const meta = parseStorybookMeta("VAMPIRE DIARIES", undefined);
    expect(meta.status).toBe("unreviewed");
    expect(meta.runtimeSeconds).toBeNull();
    expect(meta.hook).toBeNull();
  });
});
