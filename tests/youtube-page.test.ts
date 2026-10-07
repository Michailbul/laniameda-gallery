import { expect, test } from "bun:test";
import {
  ALL_THEMES,
  DEFAULT_THEME,
  breakoutScore,
  compareChannels,
  compareVideos,
  filtersToSearch,
  formatAge,
  groupVideos,
  homeTheme,
  matchesFilters,
  parseFilters,
  summarizeChannels,
  styleLabel,
  themeLabel,
  topicLabel,
  typicalMultiple,
  viewsPerDay,
  type PublicVideo,
} from "../lib/youtube-page";

const video = (overrides: Partial<PublicVideo>): PublicVideo => ({
  externalId: "aaaaaaaaaaa",
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  title: "A video",
  collections: ["youtube-cars-competitors"],
  tagNames: [],
  frames: [],
  ...overrides,
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 4);

const known = ["youtube-cars-competitors", "youtube-history-docs"];

test("themes put Cars first and label unknown collections readably", () => {
  expect(DEFAULT_THEME).toBe("youtube-cars-competitors");
  expect(themeLabel("youtube-cars-competitors")).toBe("Cars");
  expect(themeLabel("youtube-new-thing")).toBe("New Thing");
  expect(themeLabel("youtube-niche-bend")).toBe("Niche bend");
  expect(topicLabel("ai-original-worlds")).toBe("AI Original Worlds");
  expect(homeTheme(video({ collections: ["youtube-what-if", "youtube-cars-competitors"] }))).toBe(
    "youtube-cars-competitors",
  );
});

test("the URL round-trips and omits defaults", () => {
  expect(filtersToSearch(parseFilters({}, known))).toBe("");
  const filters = parseFilters(
    { theme: "all", sort: "breakout", style: "Map animation", q: " f1 ", best: "1", channel: "@x" },
    known,
  );
  expect(filters).toEqual({
    view: "videos",
    theme: ALL_THEMES,
    sort: "breakout",
    style: "Map animation",
    channel: "@x",
    query: "f1",
    bestOnly: true,
  });
  expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToSearch(filters))), known)).toEqual(filters);
});

test("stale or hand-edited links fall back to defaults", () => {
  const filters = parseFilters({ theme: "nope", sort: "sideways", view: "grid" }, known);
  expect(filters.theme).toBe(DEFAULT_THEME);
  expect(filters.sort).toBe("views");
  expect(filters.view).toBe("videos");
  expect(parseFilters({ theme: "x" }, ["youtube-history-docs"]).theme).toBe(ALL_THEMES);
  expect(parseFilters({ view: "channels", sort: "views" }, known).sort).toBe("top");
});

test("filters narrow by theme, style, channel, best and words", () => {
  const car = video({ title: "F1 Mercedes", styleFamily: "Archive", channelHandle: "@f1", isChannelBest: true });
  const doc = video({ title: "Rome", collections: ["youtube-history-docs"], channelHandle: "@rome" });
  const base = parseFilters({}, known);
  expect(matchesFilters(car, base)).toBe(true);
  expect(matchesFilters(doc, base)).toBe(false);
  expect(matchesFilters(doc, { ...base, theme: ALL_THEMES })).toBe(true);
  expect(matchesFilters(car, { ...base, style: "Map" })).toBe(false);
  expect(matchesFilters(car, { ...base, channel: "@f1", bestOnly: true })).toBe(true);
  expect(matchesFilters(car, { ...base, query: "mercedes f1" })).toBe(true);
  expect(matchesFilters(car, { ...base, query: "ferrari" })).toBe(false);
});

test("sorts order by views, breakout, channel size, length and name", () => {
  const small = video({ title: "B", views: 500_000, subscribers: 10_000, durationSeconds: 100, channelName: "Zed" });
  const big = video({ title: "A", views: 900_000, subscribers: 3_000_000, durationSeconds: 900, channelName: "Alpha" });
  const unknown = video({ title: "C", views: 1_000_000, channelName: "Mid" });
  const order = (sort: Parameters<typeof compareVideos>[0]) =>
    [small, big, unknown].sort(compareVideos(sort)).map((entry) => entry.title);
  expect(order("views")).toEqual(["C", "A", "B"]);
  expect(order("breakout")).toEqual(["B", "A", "C"]);
  expect(order("subscribers")).toEqual(["A", "B", "C"]);
  expect(order("longest")).toEqual(["A", "B", "C"]);
  expect(order("channel")).toEqual(["A", "C", "B"]);
  expect(order("title")).toEqual(["A", "B", "C"]);
  expect(breakoutScore(unknown)).toBe(-1);
});

test("channels group their videos best first and sort", () => {
  const rows = [
    video({ externalId: "a", channelHandle: "@one", channelName: "One", views: 10, subscribers: 5 }),
    video({ externalId: "b", channelHandle: "@one", channelName: "One", views: 90 }),
    video({ externalId: "c", channelHandle: "@two", channelName: "Two", views: 50, subscribers: 100 }),
  ];
  const channels = summarizeChannels(rows);
  expect(channels).toHaveLength(2);
  expect(channels.find((entry) => entry.id === "@one")?.videos.map((entry) => entry.externalId)).toEqual(["b", "a"]);
  expect(channels.sort(compareChannels("top")).map((entry) => entry.id)).toEqual(["@one", "@two"]);
  expect(channels.sort(compareChannels("subscribers")).map((entry) => entry.id)).toEqual(["@two", "@one"]);
  expect(channels.sort(compareChannels("count")).map((entry) => entry.id)).toEqual(["@one", "@two"]);
});

test("the thumbnail wall keeps its view, size and grouping in the URL", () => {
  const filters = parseFilters(
    { view: "thumbnails", sort: "velocity", made: "2D animation", since: "90d", fits: "1", size: "study", group: "topic" },
    known,
  );
  expect(filters.view).toBe("thumbnails");
  expect(filters.sort).toBe("velocity");
  expect(filters.made).toBeUndefined();
  expect(filters.since).toBe("90d");
  expect(filters.fitsOnly).toBe(true);
  expect(filters.size).toBe("study");
  expect(filters.group).toBe("topic");
  expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToSearch(filters))), known)).toEqual(filters);
  // The default size is left out of the link, and the wall's controls mean nothing elsewhere.
  expect(filtersToSearch(parseFilters({ view: "thumbnails", size: "shelf" }, known))).toBe("?view=thumbnails");
  const videos = parseFilters({ view: "videos", size: "study", group: "made", since: "5y" }, known);
  expect(videos.size).toBeUndefined();
  expect(videos.group).toBeUndefined();
  expect(videos.since).toBeUndefined();
});

test("legacy origin filters are ignored; upload windows and our checks still narrow", () => {
  const drawn = video({ productionStyle: "2D animation", publishedAt: NOW - 20 * DAY, tagNames: ["passes-filters"] });
  const stock = video({ productionStyle: "Stock footage", publishedAt: NOW - 120 * DAY });
  const undated = video({});
  const base = parseFilters({}, known);
  expect(matchesFilters(drawn, { ...base, made: "2D animation" }, NOW)).toBe(true);
  expect(matchesFilters(stock, { ...base, made: "2D animation" }, NOW)).toBe(true);
  expect(matchesFilters(drawn, { ...base, since: "30d" }, NOW)).toBe(true);
  expect(matchesFilters(stock, { ...base, since: "90d" }, NOW)).toBe(false);
  expect(matchesFilters(stock, { ...base, since: "180d" }, NOW)).toBe(true);
  expect(matchesFilters(undated, { ...base, since: "180d" }, NOW)).toBe(false);
  expect(matchesFilters(drawn, { ...base, fitsOnly: true }, NOW)).toBe(true);
  expect(matchesFilters(stock, { ...base, fitsOnly: true }, NOW)).toBe(false);
  expect(matchesFilters(stock, { ...base, query: "stock footage" }, NOW)).toBe(true);
});

test("views per day ranks what works now, and the multiple shows a video against its channel", () => {
  const fresh = video({ title: "Fresh", views: 300_000, publishedAt: NOW - 10 * DAY, medianViews: 20_000 });
  const old = video({ title: "Old", views: 2_000_000, publishedAt: NOW - 400 * DAY, medianViews: 1_000_000 });
  const undated = video({ title: "Undated", views: 5_000_000 });
  expect([old, undated, fresh].sort(compareVideos("velocity", NOW)).map((entry) => entry.title)).toEqual([
    "Fresh",
    "Old",
    "Undated",
  ]);
  expect(viewsPerDay(video({ views: 500, publishedAt: NOW - DAY / 24 }), NOW)).toBe(500);
  expect(typicalMultiple(fresh)).toBe(15);
  expect(typicalMultiple(undated)).toBeUndefined();
  expect(formatAge(NOW - 19 * DAY, NOW)).toBe("19 d");
  expect(formatAge(NOW - 122 * DAY, NOW)).toBe("4 mo");
  expect(formatAge(NOW - 800 * DAY, NOW)).toBe("2 y");
  expect(formatAge(undefined, NOW)).toBe("");
});

test("the wall groups by niche, unlabelled last", () => {
  const rows = [
    video({ externalId: "a", productionStyle: "Stock footage", topic: "true-crime" }),
    video({ externalId: "b", productionStyle: "2D animation", topic: "history" }),
    video({ externalId: "c", productionStyle: "2D animation", topic: "history" }),
    video({ externalId: "d" }),
  ];
  expect(groupVideos(rows, "topic").map((section) => section.label)).toEqual(["History", "True Crime", "Not labelled"]);
});

test("a channel carries how it is made and its last upload", () => {
  const [channel] = summarizeChannels([
    video({ externalId: "a", channelHandle: "@one", views: 10, productionStyle: "Whiteboard animation", channelLastUploadAt: 5 }),
    video({ externalId: "b", channelHandle: "@one", views: 90, productionStyle: "Whiteboard animation", channelLastUploadAt: 9 }),
  ]);
  expect(channel.made).toBe("Whiteboard animation");
  expect(channel.lastUploadAt).toBe(9);
});

test("legacy made links do not filter videos or expose a provenance group", () => {
  const filters = parseFilters({ view: "thumbnails", made: "AI pictures", group: "made" }, known);
  expect(filters.made).toBeUndefined();
  expect(filters.group).toBeUndefined();
  expect(filtersToSearch(filters)).toBe("?view=thumbnails");
});

test("legacy visual styles display without origin words while their keys still match", () => {
  expect(styleLabel("AI stills with voiceover")).toBe("stills with voiceover");
  expect(styleLabel("stock footage, charts and headline screenshots")).toBe("footage, charts and headline screenshots");
  expect(styleLabel("AI-generated pictures & motion graphics")).toBe("pictures & motion graphics");
  expect(styleLabel("AI / stock")).toBe("");
  expect(styleLabel("3D animation")).toBe("3D animation");
  const entry = video({ styleFamily: "AI stills with voiceover" });
  expect(matchesFilters(entry, { ...parseFilters({}, known), style: entry.styleFamily })).toBe(true);
});
