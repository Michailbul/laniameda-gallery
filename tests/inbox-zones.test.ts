import { describe, expect, test } from "bun:test";
import { INBOX_CHOICES_BY_TYPE } from "../lib/inbox";
import { zoneActions, zoneAt, zoneState } from "../lib/inbox-zones";

const asset = "asset123";

describe("zoneActions", () => {
  test("artifact: keep is keep, archive is out", () => {
    expect(zoneActions({ type: "artifact" }, asset)).toEqual({ comment: true, keep: { choice: "keep" }, archive: { choice: "out" } });
  });

  test("choose and A/B keep this image and have no archive", () => {
    expect(zoneActions({ type: "choose" }, asset)).toEqual({ comment: true, keep: { choice: "pick", pickedAssetId: asset } });
    expect(zoneActions({ type: "ab" }, asset)).toEqual({ comment: true, keep: { choice: "winner", pickedAssetId: asset } });
  });

  test("duplicates and rule cards only comment", () => {
    expect(zoneActions({ type: "duplicates" }, asset)).toEqual({ comment: true });
    expect(zoneActions({ type: "rule" }, asset, false)).toEqual({ comment: false });
  });

  test("sort archives into its Out target only when it has a live one", () => {
    const targets = [{ hotkey: 1, kind: "moodboard" }, { hotkey: 4, kind: "out" }];
    expect(zoneActions({ type: "sort", targets }, asset).archive).toEqual({ choice: "target", targetHotkey: 4 });
    expect(zoneActions({ type: "sort", targets: [{ hotkey: 4, kind: "out", missing: true }] }, asset).archive).toBeUndefined();
    expect(zoneActions({ type: "sort", targets: [targets[0]!] }, asset)).toEqual({ comment: true });
  });

  test("every zone answer is one its card type accepts", () => {
    for (const type of Object.keys(INBOX_CHOICES_BY_TYPE) as (keyof typeof INBOX_CHOICES_BY_TYPE)[]) {
      const actions = zoneActions({ type, targets: [{ hotkey: 2, kind: "out" }] }, asset);
      for (const answer of [actions.keep, actions.archive]) {
        if (answer) expect(INBOX_CHOICES_BY_TYPE[type]).toContain(answer.choice);
      }
    }
  });
});

describe("zoneState", () => {
  test("kept only for this image's pick", () => {
    const actions = zoneActions({ type: "choose" }, asset);
    expect(zoneState(actions, { choice: "pick", pickedAssetId: asset })).toEqual({ kept: true, archived: false });
    expect(zoneState(actions, { choice: "pick", pickedAssetId: "other" }).kept).toBe(false);
    expect(zoneState(actions, null)).toEqual({ kept: false, archived: false });
  });

  test("archived for out and for a sort's Out target", () => {
    expect(zoneState(zoneActions({ type: "artifact" }, asset), { choice: "out" }).archived).toBe(true);
    const sort = zoneActions({ type: "sort", targets: [{ hotkey: 3, kind: "out" }] }, asset);
    expect(zoneState(sort, { choice: "target", targetHotkey: 3 }).archived).toBe(true);
    expect(zoneState(sort, { choice: "target", targetHotkey: 1 }).archived).toBe(false);
  });
});

describe("zoneAt", () => {
  const all = zoneActions({ type: "artifact" }, asset);
  test("left third keeps, right third archives, bottom middle comments", () => {
    expect(zoneAt(0.1, 0.5, all)).toBe("keep");
    expect(zoneAt(0.9, 0.1, all)).toBe("archive");
    expect(zoneAt(0.5, 0.9, all)).toBe("comment");
    expect(zoneAt(0.5, 0.3, all)).toBeNull();
    expect(zoneAt(1.2, 0.5, all)).toBeNull();
  });

  test("a zone the card lacks is no zone", () => {
    const commentOnly = zoneActions({ type: "duplicates" }, asset);
    expect(zoneAt(0.1, 0.5, commentOnly)).toBeNull();
    expect(zoneAt(0.9, 0.5, commentOnly)).toBeNull();
    expect(zoneAt(0.5, 0.9, commentOnly)).toBe("comment");
  });
});
