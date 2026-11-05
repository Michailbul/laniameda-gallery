import { describe, expect, test } from "bun:test";
import {
  filterCollections, filterTags, pageRows, projectAgentAsset, projectCollectionRow, projectSlimTag, projectStoryRow,
  sortTagsByUsage, storyListPage,
} from "../lib/agent-read-projections";

// The rows the agent read tools return: no storage plumbing, bounded text,
// and filters that narrow the owner's whole tree or vocabulary.

describe("agent read projections", () => {
  const folders = [
    { _id: "root", name: "DEAR ANNETE", worldKey: "dear-annete", memberCount: 1200, description: "The film world.", ownerUserId: "o", normalizedName: "dear annete", publicMemberCount: 3, _creationTime: 1 },
    { _id: "shelf", name: "Homes", parentFolderId: "root", group: "Places", sortOrder: 2, memberCount: 40, ownerUserId: "o", normalizedName: "homes", _creationTime: 2 },
    { _id: "book", name: "The Missed Tram", parentFolderId: "root", kind: "storybook", memberCount: 12, ownerUserId: "o", normalizedName: "the missed tram", _creationTime: 3 },
    { _id: "art", name: "ART", memberCount: 900, hiddenFromGallery: true, ownerUserId: "o", normalizedName: "art", _creationTime: 4 },
    { _id: "srefs", name: "Midjourney Srefs", memberCount: 30, ownerUserId: "o", normalizedName: "midjourney srefs", _creationTime: 5 },
  ];

  test("collections project to agent fields and filter by world, parent, roots, kind and search", () => {
    const row = projectCollectionRow({ ...folders[1]!, url: "https://g/w/dear-annete/shelf" });
    expect(row).toEqual({ _id: "shelf", name: "Homes", parentFolderId: "root", group: "Places", sortOrder: 2, isWorld: false, memberCount: 40, url: "https://g/w/dear-annete/shelf" });
    expect(Object.keys(row)).not.toContain("ownerUserId");
    expect(projectCollectionRow(folders[0]!)).toMatchObject({ isWorld: true, worldKey: "dear-annete", description: "The film world." });
    expect(projectCollectionRow(folders[3]!).hidden).toBe(true);

    expect(filterCollections(folders, { ids: ["root", "shelf", "book"] }).map((f) => f._id)).toEqual(["root", "shelf", "book"]);
    expect(filterCollections(folders, { parentFolderId: "root" }).map((f) => f._id)).toEqual(["shelf", "book"]);
    expect(filterCollections(folders, { rootsOnly: true }).map((f) => f._id)).toEqual(["root", "art", "srefs"]);
    expect(filterCollections(folders, { kind: "storybook" }).map((f) => f._id)).toEqual(["book"]);
    expect(filterCollections(folders, { kind: "plain", parentFolderId: "root" }).map((f) => f._id)).toEqual(["shelf"]);
    expect(filterCollections(folders, { search: "srefs" }).map((f) => f._id)).toEqual(["srefs"]);
    expect(filterCollections(folders, { search: "dear film" }).map((f) => f._id)).toEqual(["root"]);
    expect(filterCollections(folders, {})).toHaveLength(5);
  });

  test("asset rows drop storage keys, owner, tag ids and pack slots and cut long prompts", () => {
    const prompt = "A ".repeat(400).trim();
    const row = projectAgentAsset({
      _id: "a1", _creationTime: 5, ownerUserId: "telegram:1", kind: "image", r2Key: "k", r2Bucket: "b", thumbR2Key: "tk", thumbR2Bucket: "tb",
      storageId: "s", thumbStorageId: "ts", tagIds: ["t1"], tagNames: ["scene"], ingestSource: "agent", packSlotIndex: 2, designInspirationId: "d",
      promptText: prompt, url: "https://u", thumbUrl: "https://t", agentDescription: "desc", score: 0.9, visualScore: 0.8, folderIds: ["f"], undefinedField: undefined,
    });
    expect(row).toMatchObject({ _id: "a1", kind: "image", tagNames: ["scene"], url: "https://u", thumbUrl: "https://t", agentDescription: "desc", score: 0.9, visualScore: 0.8, folderIds: ["f"], promptTruncated: true, promptChars: prompt.length });
    for (const key of ["ownerUserId", "r2Key", "r2Bucket", "thumbR2Key", "thumbR2Bucket", "storageId", "thumbStorageId", "tagIds", "ingestSource", "packSlotIndex", "designInspirationId", "_creationTime", "undefinedField"]) {
      expect(row).not.toHaveProperty(key);
    }
    expect((row.promptText as string).length).toBeLessThanOrEqual(301);
    expect(projectAgentAsset({ _id: "a2", promptText: "short" })).toEqual({ _id: "a2", promptText: "short" });
  });

  test("story rows lose searchText and owner, carry an excerpt unless includeBody, and the page says how to continue", () => {
    const body = `${"word ".repeat(100)}end`;
    const story = { _id: "s1", _creationTime: 1, ownerUserId: "o", searchText: body.toLowerCase(), title: "T", body, kind: "script", status: "draft", ingestKey: "k", revision: 2, updatedAt: 500 };
    const slim = projectStoryRow(story, false);
    expect(slim).toMatchObject({ _id: "s1", title: "T", kind: "script", ingestKey: "k", revision: 2, bodyChars: body.length });
    expect(slim).not.toHaveProperty("body");
    expect(slim).not.toHaveProperty("searchText");
    expect(slim).not.toHaveProperty("ownerUserId");
    expect(slim).not.toHaveProperty("_creationTime");
    expect((slim as { excerpt: string }).excerpt.length).toBeLessThanOrEqual(301);
    expect((slim as { excerpt: string }).excerpt.endsWith("…")).toBe(true);
    const full = projectStoryRow(story, true);
    expect(full).toMatchObject({ body, bodyChars: body.length });
    expect(full).not.toHaveProperty("excerpt");

    expect(storyListPage([{ updatedAt: 900 }, { updatedAt: 500 }], 2)).toEqual({ count: 2, limit: 2, truncated: true, next: { updatedBefore: 500 } });
    expect(storyListPage([{ updatedAt: 900 }], 200)).toEqual({ count: 1, limit: 200, truncated: false });
  });

  test("tags filter by search, category and usage, sort by usage, page by offset and project slim", () => {
    const rows = [
      { name: "golden-hour", label: "golden-hour", normalizedLabel: "golden-hour", category: "lighting", usageCount: 40, isCustomized: false },
      { name: "cinematic", label: "Cinematic", normalizedLabel: "cinematic", category: "style", description: "film look", usageCount: 120, isCustomized: true },
      { name: "street", label: "street", normalizedLabel: "street", category: "environment", usageCount: 3, isCustomized: false, archivedAt: 1 },
      { name: "lighting-test", label: "lighting-test", normalizedLabel: "lighting-test", category: "custom", usageCount: 0, isCustomized: false },
    ];
    expect(filterTags(rows, { search: "light" }).map((r) => r.name)).toEqual(["lighting-test"]);
    expect(filterTags(rows, { category: "lighting" }).map((r) => r.name)).toEqual(["golden-hour"]);
    expect(filterTags(rows, { minUsage: 10 }).map((r) => r.name)).toEqual(["golden-hour", "cinematic"]);
    expect(filterTags(rows, { search: "CINE" }).map((r) => r.name)).toEqual(["cinematic"]);
    expect(sortTagsByUsage(rows).map((r) => r.name)).toEqual(["cinematic", "golden-hour", "street", "lighting-test"]);

    expect(projectSlimTag(rows[1]!)).toEqual({ name: "cinematic", label: "Cinematic", category: "style", description: "film look", usageCount: 120, customized: true });
    expect(projectSlimTag(rows[2]!)).toEqual({ name: "street", category: "environment", usageCount: 3, archived: true });

    const sorted = sortTagsByUsage(rows);
    const first = pageRows(sorted, null, 3);
    expect(first).toMatchObject({ count: 3, total: 4, limit: 3, cursor: "3", isDone: false });
    const second = pageRows(sorted, first.cursor, 3);
    expect(second).toMatchObject({ count: 1, total: 4, cursor: null, isDone: true });
    expect(second.page[0]!.name).toBe("lighting-test");
    expect(pageRows(sorted, "garbage", 10)).toMatchObject({ count: 4, isDone: true, cursor: null });
    expect(pageRows(sorted, null, 5000).limit).toBe(500);
  });
});
