import { expect, test } from "bun:test";
import {
  ALL_THEMES,
  DEFAULT_THEME,
  breakoutScore,
  compareChannels,
  compareVideos,
  filtersToSearch,
  homeTheme,
  matchesFilters,
  parseFilters,
  summarizeChannels,
  themeLabel,
  type PublicVideo,
} from "../lib/youtube-page";

const video = (overrides: Partial<PublicVideo>): PublicVideo => ({
  externalId: "aaaaaaaaaaa",
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  title: "A video",
  collections: ["youtube-cars-competitors"],
  frames: [],
  ...overrides,
});

const known = ["youtube-cars-competitors", "youtube-history-docs"];

test("themes put Cars first and label unknown collections readably", () => {
  expect(DEFAULT_THEME).toBe("youtube-cars-competitors");
  expect(themeLabel("youtube-cars-competitors")).toBe("Cars");
  expect(themeLabel("youtube-new-thing")).toBe("New Thing");
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
