import { describe, expect, test } from "bun:test";

import { LIKE_DOUBLE_MS, likeLevelOf, type LikeLevel } from "../lib/asset-hotkeys";
import { createLikePresses, likeAfterPress } from "../lib/like-presses";

const settle = () => new Promise((resolve) => setTimeout(resolve, LIKE_DOUBLE_MS + 80));

const harness = () => {
  const saved: Array<[string, LikeLevel]> = [];
  const errors: string[] = [];
  const presses = createLikePresses({
    doubleMs: LIKE_DOUBLE_MS,
    save: async (assetId, level) => {
      saved.push([assetId, level]);
    },
    onError: (assetId) => errors.push(assetId),
  });
  return { saved, errors, presses };
};

describe("key 1: like, and super like on a double press", () => {
  test("levels", () => {
    expect(likeLevelOf(false, false)).toBe("none");
    expect(likeLevelOf(true, false)).toBe("like");
    expect(likeLevelOf(true, 123)).toBe("super");
    expect(likeAfterPress("none", false)).toBe("like");
    expect(likeAfterPress("like", false)).toBe("none");
    expect(likeAfterPress("super", false)).toBe("none");
    expect(likeAfterPress("none", true)).toBe("super");
  });

  test("one press likes at once and saves once the double window has passed", async () => {
    const { saved, presses } = harness();
    expect(presses.press("a", "none", 1000)).toBe("like");
    expect(saved).toEqual([]);
    await settle();
    expect(saved).toEqual([["a", "like"]]);
  });

  test("a double press shows like, then super, and writes super once", async () => {
    const { saved, presses } = harness();
    expect(presses.press("a", "none", 1000)).toBe("like");
    expect(presses.press("a", "like", 1000 + LIKE_DOUBLE_MS - 1)).toBe("super");
    await settle();
    expect(saved).toEqual([["a", "super"]]);
  });

  test("a double press on a liked frame upgrades it", async () => {
    const { saved, presses } = harness();
    expect(presses.press("a", "like", 1000)).toBe("none");
    expect(presses.press("a", "none", 1200)).toBe("super");
    await settle();
    expect(saved).toEqual([["a", "super"]]);
  });

  test("one press takes a like or a super like off; a slow second press likes again", async () => {
    const { saved, presses } = harness();
    expect(presses.press("a", "super", 1000)).toBe("none");
    expect(presses.press("b", "like", 1000)).toBe("none");
    expect(presses.press("a", "none", 1000 + LIKE_DOUBLE_MS + 1)).toBe("like");
    await settle();
    expect(saved.sort()).toEqual([["a", "like"], ["b", "none"]]);
  });

  test("the press after a double starts fresh, and a press on another frame is its own", async () => {
    const { saved, presses } = harness();
    presses.press("a", "none", 1000);
    presses.press("a", "like", 1100);
    expect(presses.press("a", "super", 1200)).toBe("none");
    expect(presses.press("b", "none", 1250)).toBe("like");
    await settle();
    expect(saved.sort()).toEqual([["a", "none"], ["b", "like"]]);
  });

  test("flush sends what still waits; a failed save reports its frame", async () => {
    const { saved, presses } = harness();
    presses.press("a", "none", 1000);
    presses.flush();
    expect(saved).toEqual([["a", "like"]]);

    const failed: string[] = [];
    const failing = createLikePresses({
      doubleMs: LIKE_DOUBLE_MS,
      save: async () => {
        throw new Error("offline");
      },
      onError: (assetId) => failed.push(assetId),
    });
    failing.press("c", "none", 1000);
    failing.flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failed).toEqual(["c"]);
  });
});
