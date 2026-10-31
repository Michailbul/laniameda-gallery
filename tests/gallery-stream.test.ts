import { describe, expect, test } from "bun:test";
import { appendGalleryEntries, reachedGalleryInserts, reuseUnchangedEntries } from "../lib/gallery-stream";

const asset = (id: string, createdAt: number) => ({ id, createdAt });

describe("gallery pagination ordering", () => {
  test("fast skills cannot expose dates beyond the loaded asset frontier", () => {
    const skills = [asset("recent-skill", 250), asset("boundary-skill", 200), asset("old-skill", 50)];
    const firstPage = [asset("first", 300), asset("second", 200)];
    expect(reachedGalleryInserts(skills, [], false)).toEqual([]);
    expect(reachedGalleryInserts(skills, firstPage, false).map((entry) => entry.id))
      .toEqual(["recent-skill"]);
    const nextPage = [...firstPage, asset("third", 100)];
    expect(reachedGalleryInserts(skills, nextPage, false).map((entry) => entry.id))
      .toEqual(["recent-skill", "boundary-skill"]);
    expect(reachedGalleryInserts(skills, nextPage, true)).toEqual(skills);
  });

  test("empty completed galleries still show skills; membership cursors wait for completion", () => {
    const skills = [asset("skill", 100)];
    expect(reachedGalleryInserts(skills, [], true)).toEqual(skills);
    expect(reachedGalleryInserts(skills, [asset("old-file-added-recently", 10)], false, false)).toEqual([]);
    expect(reachedGalleryInserts(skills, [asset("old-file-added-recently", 10)], true, false)).toEqual(skills);
  });

  test("later pages and late inserts append without moving exposed tiles", () => {
    const first = [asset("new", 300), asset("skill", 250), asset("middle", 200)];
    const incoming = [asset("late-skill", 350), ...first, asset("older", 100)];
    expect(appendGalleryEntries(first, incoming).map((entry) => entry.id))
      .toEqual(["new", "skill", "middle", "late-skill", "older"]);
    const completed = appendGalleryEntries(first, incoming);
    expect(appendGalleryEntries(completed, incoming)).toEqual(completed);
  });

  test("updates current tile data, removes deleted tiles, and preserves a pack when its cover changes", () => {
    const first = [{ ...asset("cover", 300), packId: "pack:1" }, asset("removed", 200), asset("last", 100)];
    const replacement = { ...asset("new-cover", 400), packId: "pack:1" };
    const incoming = [asset("last", 150), replacement, asset("added", 50)];
    const result = appendGalleryEntries(first, incoming);
    expect(result).toEqual([replacement, asset("last", 150), asset("added", 50)]);
    expect(result[0]).toBe(replacement);
  });
});

describe("entry identity across rebuilds", () => {
  const entry = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    src: `${id}.jpg`,
    tagNames: ["a"],
    previewImages: [{ id: `${id}-p`, src: `${id}-p.jpg` }],
    ...extra,
  });

  test("an append keeps every unchanged card's object and adds the new ones", () => {
    const first = [entry("a"), entry("b")];
    const rebuilt = [entry("a"), entry("b"), entry("c")];
    const kept = reuseUnchangedEntries(first, rebuilt);
    expect(kept[0]).toBe(first[0]);
    expect(kept[1]).toBe(first[1]);
    expect(kept[2]).toBe(rebuilt[2]);
  });

  test("a re-emit with no change returns the previous array", () => {
    const first = [entry("a"), entry("b")];
    expect(reuseUnchangedEntries(first, [entry("a"), entry("b")])).toBe(first);
  });

  test("a changed entry gets its new object so realtime updates reach the card", () => {
    const first = [entry("a", { isLiked: false }), entry("b")];
    const liked = reuseUnchangedEntries(first, [entry("a", { isLiked: true }), entry("b")]);
    expect(liked[0]).not.toBe(first[0]);
    expect(liked[1]).toBe(first[1]);
    const retagged = reuseUnchangedEntries(first, [entry("a", { isLiked: false }), entry("b", { tagNames: ["a", "b"] })]);
    expect(retagged[1]).not.toBe(first[1]);
    const newThumb = reuseUnchangedEntries(first, [
      entry("a", { isLiked: false }),
      { ...entry("b"), previewImages: [{ id: "b-p", src: "b-p2.jpg" }] },
    ]);
    expect(newThumb[1]).not.toBe(first[1]);
    const starred = reuseUnchangedEntries(first, [entry("a", { isLiked: false, starredAt: 5 }), entry("b")]);
    expect(starred[0]).not.toBe(first[0]);
  });

  test("a card that finished loading does not count as a change", () => {
    const first = [entry("a", { initiallyLoaded: false })];
    const kept = reuseUnchangedEntries(first, [entry("a", { initiallyLoaded: true })]);
    expect(kept).toBe(first);
  });

  test("reordering keeps objects but returns a new array", () => {
    const first = [entry("a"), entry("b")];
    const swapped = reuseUnchangedEntries(first, [entry("b"), entry("a")]);
    expect(swapped).not.toBe(first);
    expect(swapped[0]).toBe(first[1]);
    expect(swapped[1]).toBe(first[0]);
  });
});
