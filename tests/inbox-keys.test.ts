import { describe, expect, test } from "bun:test";
import { INBOX_CHOICES_BY_TYPE } from "../lib/inbox";
import { imageActions, imageKeyHint, imageKeyOf, imageState, isDigitKey } from "../lib/inbox-keys";

const asset = "asset123";

describe("imageActions", () => {
  test("artifact: approve is keep, archive is out", () => {
    expect(imageActions({ type: "artifact" }, asset)).toEqual({ comment: true, keep: { choice: "keep" }, archive: { choice: "out" } });
  });

  test("choose and A/B approve this image and have no archive", () => {
    expect(imageActions({ type: "choose" }, asset)).toEqual({ comment: true, keep: { choice: "pick", pickedAssetId: asset } });
    expect(imageActions({ type: "ab" }, asset)).toEqual({ comment: true, keep: { choice: "winner", pickedAssetId: asset } });
  });

  test("duplicates and rule cards only comment", () => {
    expect(imageActions({ type: "duplicates" }, asset)).toEqual({ comment: true });
    expect(imageActions({ type: "rule" }, asset, false)).toEqual({ comment: false });
  });

  test("sort archives into its Out target only when it has a live one", () => {
    const targets = [{ hotkey: 1, kind: "moodboard" }, { hotkey: 4, kind: "out" }];
    expect(imageActions({ type: "sort", targets }, asset).archive).toEqual({ choice: "target", targetHotkey: 4 });
    expect(imageActions({ type: "sort", targets: [{ hotkey: 4, kind: "out", missing: true }] }, asset).archive).toBeUndefined();
    expect(imageActions({ type: "sort", targets: [targets[0]!] }, asset)).toEqual({ comment: true });
  });

  test("every key answer is one its card type accepts", () => {
    for (const type of Object.keys(INBOX_CHOICES_BY_TYPE) as (keyof typeof INBOX_CHOICES_BY_TYPE)[]) {
      const actions = imageActions({ type, targets: [{ hotkey: 2, kind: "out" }] }, asset);
      for (const answer of [actions.keep, actions.archive]) {
        if (answer) expect(INBOX_CHOICES_BY_TYPE[type]).toContain(answer.choice);
      }
    }
  });
});

describe("imageState", () => {
  test("kept only for this image's pick", () => {
    const actions = imageActions({ type: "choose" }, asset);
    expect(imageState(actions, { choice: "pick", pickedAssetId: asset })).toEqual({ kept: true, archived: false });
    expect(imageState(actions, { choice: "pick", pickedAssetId: "other" }).kept).toBe(false);
    expect(imageState(actions, null)).toEqual({ kept: false, archived: false });
  });

  test("archived for out and for a sort's Out target", () => {
    expect(imageState(imageActions({ type: "artifact" }, asset), { choice: "out" }).archived).toBe(true);
    const sort = imageActions({ type: "sort", targets: [{ hotkey: 3, kind: "out" }] }, asset);
    expect(imageState(sort, { choice: "target", targetHotkey: 3 }).archived).toBe(true);
    expect(imageState(sort, { choice: "target", targetHotkey: 1 }).archived).toBe(false);
  });
});

describe("imageKeyOf", () => {
  test("1 / A / K approve, 2 / X archive, 3 / C comment, 4 open", () => {
    expect(["1", "a", "K"].map((key) => imageKeyOf(key))).toEqual(["keep", "keep", "keep"]);
    expect(["2", "x"].map((key) => imageKeyOf(key))).toEqual(["archive", "archive"]);
    expect(["3", "C"].map((key) => imageKeyOf(key))).toEqual(["comment", "comment"]);
    expect(imageKeyOf("4")).toBe("open");
    expect(imageKeyOf("5")).toBeNull();
    expect(imageKeyOf("s")).toBeNull();
  });

  test("digits come from the physical key on any layout", () => {
    // A Czech keyboard types "+" on the 1 key.
    expect(imageKeyOf("+", "Digit1")).toBe("keep");
    expect(imageKeyOf("2", "Numpad2")).toBe("archive");
    expect(isDigitKey("+", "Digit1")).toBe(true);
    expect(isDigitKey("x", "KeyX")).toBe(false);
  });
});

describe("imageKeyHint", () => {
  test("lists only the keys the card type takes", () => {
    const artifact = imageKeyHint(imageActions({ type: "artifact" }, asset)).map((entry) => `${entry.key} ${entry.label}`);
    expect(artifact).toEqual(["1 approve", "2 archive", "3 comment", "4 open"]);
    const choose = imageKeyHint(imageActions({ type: "choose" }, asset), { zoom: true }).map((entry) => `${entry.key} ${entry.label}`);
    expect(choose).toEqual(["1 approve", "3 comment", "4 close"]);
  });

  test("a sort card's own image shows letters, since its numbers are targets", () => {
    const sort = imageActions({ type: "sort", targets: [{ hotkey: 3, kind: "out" }] }, asset);
    expect(imageKeyHint(sort, { letters: true }).map((entry) => entry.key)).toEqual(["X", "C", "F"]);
  });
});
