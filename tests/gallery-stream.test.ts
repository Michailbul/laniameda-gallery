import { describe, expect, test } from "bun:test";
import { appendGalleryEntries, reachedGalleryInserts } from "../lib/gallery-stream";

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
