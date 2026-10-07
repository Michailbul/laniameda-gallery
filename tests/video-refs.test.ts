import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildVideoRefSearchText,
  compareVideoRefs,
  formatCount,
  formatDuration,
  matchesVideoRef,
  normalizeLabel,
  parseYouTubeId,
  youTubeEmbedUrl,
  youTubeFrameCandidates,
  videoRefStillMetadata,
  type VideoRefSortable,
} from "../lib/video-refs";
import { getVideoRef, listVideoRefsPage, upsertVideoRef, updateVideoRef } from "../convex/videoRefs";
import { videoRefsPageInputSchema } from "../lib/video-ref-contract";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const row = (overrides: Partial<VideoRefSortable>): VideoRefSortable => ({
  createdAt: 1,
  collections: [],
  searchText: "",
  ...overrides,
});

test("parseYouTubeId reads every common link shape and rejects the rest", () => {
  const id = "dqCGNrQ6N_o";
  expect(parseYouTubeId(id)).toBe(id);
  expect(parseYouTubeId(`https://www.youtube.com/watch?v=${id}&t=42s`)).toBe(id);
  expect(parseYouTubeId(`https://youtu.be/${id}?si=abc`)).toBe(id);
  expect(parseYouTubeId(`https://m.youtube.com/shorts/${id}`)).toBe(id);
  expect(parseYouTubeId(`youtube.com/embed/${id}`)).toBe(id);
  expect(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${id}`)).toBe(id);
  expect(parseYouTubeId("https://vimeo.com/12345678901")).toBeNull();
  expect(parseYouTubeId("https://www.youtube.com/@BigCar2/videos")).toBeNull();
  expect(parseYouTubeId("not a link")).toBeNull();
});

test("embed and still URLs point at YouTube's own hosts", () => {
  expect(youTubeEmbedUrl("dqCGNrQ6N_o")).toBe(
    "https://www.youtube-nocookie.com/embed/dqCGNrQ6N_o?rel=0",
  );
  expect(youTubeEmbedUrl("dqCGNrQ6N_o", true)).toContain("autoplay=1");
  expect(youTubeFrameCandidates("dqCGNrQ6N_o", 2)[0]).toBe(
    "https://i.ytimg.com/vi/dqCGNrQ6N_o/maxres2.jpg",
  );
});

test("legacy numbered stills never claim sought timestamps; supplied captions retain provenance", () => {
  expect(videoRefStillMetadata({ label: "25%" }, 0)).toEqual({ label: "YouTube still 1", sourceKind: "youtube-auto-still", sourceUrl: undefined, positionVerified: false });
  expect(videoRefStillMetadata({ label: "Custom selected close-up", sourceKind: "supplied-still", sourceUrl: "https://example.com/still.jpg" }, 1)).toEqual({ label: "Custom selected close-up", sourceKind: "supplied-still", sourceUrl: "https://example.com/still.jpg", positionVerified: false });
  expect(videoRefStillMetadata({}, 0).sourceKind).toBe("legacy-unverified");
});

test("refreshing reference metadata preserves owner note, likes and stored still provenance", async () => {
  const { ctx, db } = createMockConvexMutationCtx();
  const saved = await callAsOwner(upsertVideoRef)(ctx, { ownerUserId: "owner", externalId: "dqCGNrQ6N_o", title: "Source", collections: ["first"], tagNames: ["reference"], frames: [{ r2Key: "custom", label: "selected close-up", sourceKind: "supplied-still", sourceUrl: "https://example.com/still.jpg" }] });
  await callAsOwner(updateVideoRef)(ctx, { ownerUserId: "owner", id: saved.id, userNote: "Owner note", isLiked: true });
  await callAsOwner(upsertVideoRef)(ctx, { ownerUserId: "owner", externalId: "dqCGNrQ6N_o", title: "Refreshed title", collections: ["second"], tagNames: [] });
  const row = await db.get(saved.id);
  expect(row).toMatchObject({ userNote: "Owner note", isLiked: true, collections: ["first", "second"] });
  expect(row?.frames).toEqual([{ r2Key: "custom", label: "selected close-up", sourceKind: "supplied-still", sourceUrl: "https://example.com/still.jpg" }]);
  const read = await callAsOwner(getVideoRef)(ctx, { ownerUserId: "owner", id: saved.id });
  if (read?.frames.length) expect(read.frames[0]).toMatchObject({ sourceKind: "supplied-still", positionVerified: false });
});

test("paged input rejects ignored sorting and malformed filters", () => {
  expect(videoRefsPageInputSchema.parse({ pageSize: 2, publishedAfter: "2026-10-01" }).publishedAfter).toBe(Date.parse("2026-10-01"));
  for (const input of [{ sort: "views" }, { limit: 2000 }, { ownerUserId: "other" }, { publishedAfter: "yesterday-ish" }, { onlyLiked: "yes" }, { pageSize: 201 }]) expect(videoRefsPageInputSchema.safeParse(input).success).toBe(false);
});

test("paged inventory continues through empty filtered pages and traverses all owner spellings", async () => {
  const { ctx, db } = createMockConvexMutationCtx();
  for (let i = 0; i < 7; i++) await db.insert("videoRefs", { ownerUserId: i < 5 ? "123" : "telegram:123", platform: "youtube", externalId: `id${i}`, url: "https://youtube.com", title: `Video ${i}`, collections: [], tagNames: [], frames: [], searchText: i === 0 || i === 5 ? "match" : "other", createdAt: i, updatedAt: i });
  let cursor: string | null = null;
  const ids: string[] = []; let pages = 0; let emptyContinuations = 0;
  do {
    const result = await callAsOwner(listVideoRefsPage)(ctx, { ownerUserId: "123", cursor, pageSize: 2, search: "match" });
    ids.push(...result.videos.map((video: { _id: string }) => video._id));
    if (!result.videos.length && !result.isDone) emptyContinuations++;
    cursor = result.cursor; pages++;
    if (pages === 1) await expect(callAsOwner(listVideoRefsPage)(ctx, { ownerUserId: "123", cursor, pageSize: 2, search: "changed" })).rejects.toThrow("filters changed");
  } while (cursor);
  expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(2); expect(emptyContinuations).toBeGreaterThan(0);
});

test("matchesVideoRef applies every filter", () => {
  const video = row({
    collections: ["youtube-cars-competitors"],
    topic: "cars",
    styleFamily: "Map animation",
    channelHandle: "@BigCar2",
    views: 500_000,
    publishedAt: Date.parse("2026-08-01"),
    isChannelBest: true,
    searchText: buildVideoRefSearchText(["The Fiat X1/9 Story", "Big Car", "archive photos"]),
  });
  expect(matchesVideoRef(video, {})).toBe(true);
  expect(matchesVideoRef(video, { collection: "YouTube Cars Competitors" })).toBe(true);
  expect(matchesVideoRef(video, { collection: "youtube-history" })).toBe(false);
  expect(matchesVideoRef(video, { styleFamily: "map animation" })).toBe(true);
  expect(matchesVideoRef(video, { channelHandle: "bigcar2" })).toBe(true);
  expect(matchesVideoRef(video, { search: "fiat archive" })).toBe(true);
  expect(matchesVideoRef(video, { search: "fiat tractor" })).toBe(false);
  expect(matchesVideoRef(video, { minViews: 1_000_000 })).toBe(false);
  expect(matchesVideoRef(video, { publishedAfter: Date.parse("2026-09-01") })).toBe(false);
  expect(matchesVideoRef(video, { onlyLiked: true })).toBe(false);
  expect(matchesVideoRef(video, { onlyChannelBest: true })).toBe(true);
});

test("matchesVideoRef filters by production style, language and tags", () => {
  const video = row({
    productionStyle: "Whiteboard animation",
    language: "es",
    tagNames: ["niche-bend", "whiteboard", "has-bend"],
  });
  expect(matchesVideoRef(video, { productionStyle: " whiteboard ANIMATION " })).toBe(true);
  expect(matchesVideoRef(video, { productionStyle: "Whiteboard" })).toBe(false);
  expect(matchesVideoRef(video, { productionStyle: "Stock footage" })).toBe(false);
  expect(matchesVideoRef(video, { language: "ES" })).toBe(true);
  expect(matchesVideoRef(video, { language: "en" })).toBe(false);
  expect(matchesVideoRef(video, { tagNames: [] })).toBe(true);
  expect(matchesVideoRef(video, { tagNames: ["Whiteboard"] })).toBe(true);
  expect(matchesVideoRef(video, { tagNames: ["Niche Bend", "has-bend"] })).toBe(true);
  expect(matchesVideoRef(video, { tagNames: ["whiteboard", "cutaway"] })).toBe(false);
  expect(
    matchesVideoRef(video, { productionStyle: "whiteboard animation", language: "es", tagNames: ["has-bend"] }),
  ).toBe(true);
  expect(
    matchesVideoRef(video, { productionStyle: "whiteboard animation", language: "en", tagNames: ["has-bend"] }),
  ).toBe(false);

  // A record saved before these fields existed matches none of the three.
  const older = row({});
  expect(matchesVideoRef(older, {})).toBe(true);
  expect(matchesVideoRef(older, { productionStyle: "Stock footage" })).toBe(false);
  expect(matchesVideoRef(older, { language: "en" })).toBe(false);
  expect(matchesVideoRef(older, { tagNames: ["whiteboard"] })).toBe(false);
});

test("production style and language are part of the search text", () => {
  const source = readFileSync(join(process.cwd(), "convex/videoRefs.ts"), "utf8");
  const start = source.indexOf("const searchTextFor = (");
  const searchTextFor = source.slice(start, source.indexOf("const toResult = (", start));
  expect(start).toBeGreaterThan(-1);
  expect(searchTextFor).toContain("row.productionStyle,");
  expect(searchTextFor).toContain("row.language,");

  const video = row({
    productionStyle: "Stock footage",
    searchText: buildVideoRefSearchText(["Every Engine Explained", "Stock footage", "en"]),
  });
  expect(matchesVideoRef(video, { search: "engine stock footage" })).toBe(true);
  expect(matchesVideoRef(video, { search: "engine whiteboard" })).toBe(false);
});

test("compareVideoRefs sorts by views, by upload date and by save time", () => {
  const a = row({ views: 100, publishedAt: 30, createdAt: 1 });
  const b = row({ views: 900, publishedAt: 10, createdAt: 2 });
  const c = row({ publishedAt: 20, createdAt: 3 });
  expect([a, b, c].sort(compareVideoRefs("views"))).toEqual([b, a, c]);
  expect([a, b, c].sort(compareVideoRefs("recent"))).toEqual([a, c, b]);
  expect([a, b, c].sort(compareVideoRefs("saved"))).toEqual([c, b, a]);
});

test("labels and numbers format the way the Videos tab shows them", () => {
  expect(normalizeLabel("  YouTube Cars Competitors ")).toBe("youtube-cars-competitors");
  expect(formatCount(63_045_845)).toBe("63M");
  expect(formatCount(1_203_193)).toBe("1.2M");
  expect(formatCount(56_800)).toBe("57K");
  expect(formatCount(undefined)).toBe("–");
  expect(formatDuration(1709)).toBe("28:29");
  expect(formatDuration(3725)).toBe("1:02:05");
});

test("video reference writes are owner-scoped and the upsert stays internal", () => {
  const source = readFileSync(join(process.cwd(), "convex/videoRefs.ts"), "utf8");
  expect(source).toContain("export const upsertVideoRef = internalMutation({");
  expect(source).toContain("export const saveVideoRefs = ownerAction({");
  expect(source).toContain("export const deleteVideoRef = ownerMutation({");
  expect(source).toContain("export const listVideoRefs = ownerQuery({");
});
