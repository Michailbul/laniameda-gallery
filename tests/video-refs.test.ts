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
  type VideoRefSortable,
} from "../lib/video-refs";

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
