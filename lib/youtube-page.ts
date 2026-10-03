// Pure helpers for the public YouTube page (/youtube). The page is a shareable
// view of the video references: every filter and the sort live in the URL, so a
// link opens the same slice.

import { normalizeLabel } from "./video-refs";

export const YOUTUBE_PATH = "/youtube";
export const youtubeVideoPath = (externalId: string) => `${YOUTUBE_PATH}/${externalId}`;

// What a visitor gets. Michael's own notes and the "bend it" idea (how he would
// reuse the format) stay in the vault.
export type PublicVideo = {
  externalId: string;
  url: string;
  title: string;
  channelName?: string;
  channelHandle?: string;
  channelUrl?: string;
  subscribers?: number;
  medianViews?: number;
  views?: number;
  publishedAt?: number;
  durationSeconds?: number;
  isChannelBest?: boolean;
  topic?: string;
  styleFamily?: string;
  styleDescription?: string;
  format?: string;
  whyItWorks?: string;
  hook?: string;
  titlePattern?: string;
  thumbnailPattern?: string;
  audience?: string;
  collections: string[];
  thumbUrl?: string;
  frames: { url: string; label?: string }[];
};

// Cars first: that is the theme this research exists for. The rest follow in
// the order the research was done. Anything unknown sorts after these.
export const THEMES: { key: string; label: string; blurb: string }[] = [
  {
    key: "youtube-cars-competitors",
    label: "Cars",
    blurb: "Faceless car channels: what they make and what works.",
  },
  { key: "youtube-history-docs", label: "History", blurb: "Documentaries and histories." },
  { key: "youtube-ai-worlds", label: "AI worlds", blurb: "Original AI films and serials." },
  { key: "youtube-style-map", label: "Animation styles", blurb: "One look per channel." },
  { key: "youtube-inner-life-thrive", label: "Inner life", blurb: "Psychology, habits, money." },
  { key: "youtube-success-stories", label: "Success stories", blurb: "Companies and people." },
  { key: "youtube-what-if", label: "What if", blurb: "Alternate history and fiction." },
];

export const DEFAULT_THEME = THEMES[0].key;
export const ALL_THEMES = "all";

const titleize = (value: string) =>
  value
    .replace(/^youtube-/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

export const themeLabel = (key: string) =>
  THEMES.find((theme) => theme.key === key)?.label ?? titleize(key);

export const themeBlurb = (key: string) => THEMES.find((theme) => theme.key === key)?.blurb ?? "";

export const themeRank = (key: string) => {
  const index = THEMES.findIndex((theme) => theme.key === key);
  return index === -1 ? THEMES.length : index;
};

export type YouTubeSort =
  | "views"
  | "recent"
  | "breakout"
  | "subscribers"
  | "longest"
  | "channel"
  | "title";

export const SORTS: { key: YouTubeSort; label: string; hint: string }[] = [
  { key: "views", label: "Most views", hint: "Highest view count first" },
  { key: "recent", label: "Newest", hint: "Latest upload first" },
  {
    key: "breakout",
    label: "Breakout",
    hint: "Views against the channel's size: the videos that beat their audience",
  },
  { key: "subscribers", label: "Channel size", hint: "Biggest channel first" },
  { key: "longest", label: "Longest", hint: "Longest runtime first" },
  { key: "channel", label: "Channel A–Z", hint: "Grouped by channel name" },
  { key: "title", label: "Title A–Z", hint: "Alphabetical by title" },
];

export const DEFAULT_SORT: YouTubeSort = "views";

export const isYouTubeSort = (value: string | undefined): value is YouTubeSort =>
  SORTS.some((sort) => sort.key === value);

const channelKey = (video: PublicVideo) =>
  (video.channelName ?? video.channelHandle ?? "").toLowerCase();

// Views per subscriber. A channel with no known size has no ratio, so it sinks.
export const breakoutScore = (video: PublicVideo) =>
  video.views !== undefined && video.subscribers ? video.views / video.subscribers : -1;

const byViews = (a: PublicVideo, b: PublicVideo) => (b.views ?? -1) - (a.views ?? -1);

export const compareVideos = (sort: YouTubeSort) => (a: PublicVideo, b: PublicVideo) => {
  switch (sort) {
    case "recent":
      return (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || byViews(a, b);
    case "breakout":
      return breakoutScore(b) - breakoutScore(a) || byViews(a, b);
    case "subscribers":
      return (b.subscribers ?? -1) - (a.subscribers ?? -1) || byViews(a, b);
    case "longest":
      return (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0) || byViews(a, b);
    case "channel":
      return channelKey(a).localeCompare(channelKey(b)) || byViews(a, b);
    case "title":
      return a.title.localeCompare(b.title);
    default:
      return byViews(a, b) || (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
  }
};

export type YouTubeView = "videos" | "channels";

export type ChannelSort = "top" | "subscribers" | "typical" | "count" | "name";

export const CHANNEL_SORTS: { key: ChannelSort; label: string; hint: string }[] = [
  { key: "top", label: "Top video", hint: "Channels ordered by their biggest video" },
  { key: "subscribers", label: "Channel size", hint: "Biggest channel first" },
  { key: "typical", label: "Typical views", hint: "Median views of a recent upload" },
  { key: "count", label: "Most videos", hint: "Most videos kept here" },
  { key: "name", label: "A–Z", hint: "Alphabetical" },
];

export const DEFAULT_CHANNEL_SORT: ChannelSort = "top";

export const isChannelSort = (value: string | undefined): value is ChannelSort =>
  CHANNEL_SORTS.some((sort) => sort.key === value);

export type YouTubeFilters = {
  view: YouTubeView;
  theme: string; // a collection label, or ALL_THEMES
  sort: YouTubeSort | ChannelSort;
  style?: string;
  channel?: string; // channel handle or name, as shown in the URL
  query?: string;
  bestOnly?: boolean;
};

export const channelId = (video: PublicVideo) => video.channelHandle ?? video.channelName ?? "";

export type ChannelSummary = {
  id: string;
  name: string;
  handle?: string;
  url?: string;
  subscribers?: number;
  medianViews?: number;
  videos: PublicVideo[]; // best first
  topViews: number;
  styles: string[];
};

export const summarizeChannels = (videos: PublicVideo[]): ChannelSummary[] => {
  const groups = new Map<string, PublicVideo[]>();
  for (const video of videos) {
    const id = channelId(video);
    if (!id) continue;
    groups.set(id, [...(groups.get(id) ?? []), video]);
  }
  return [...groups.entries()].map(([id, group]) => {
    const sorted = [...group].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    const first = sorted[0];
    return {
      id,
      name: first.channelName ?? first.channelHandle ?? id,
      handle: first.channelHandle,
      url: first.channelUrl,
      subscribers: first.subscribers,
      medianViews: first.medianViews,
      videos: sorted,
      topViews: first.views ?? 0,
      styles: countBy(sorted, (video) => (video.styleFamily ? [video.styleFamily] : [])).map(
        (entry) => entry.key,
      ),
    };
  });
};

export const compareChannels = (sort: ChannelSort) => (a: ChannelSummary, b: ChannelSummary) => {
  switch (sort) {
    case "subscribers":
      return (b.subscribers ?? -1) - (a.subscribers ?? -1) || b.topViews - a.topViews;
    case "typical":
      return (b.medianViews ?? -1) - (a.medianViews ?? -1) || b.topViews - a.topViews;
    case "count":
      return b.videos.length - a.videos.length || b.topViews - a.topViews;
    case "name":
      return a.name.localeCompare(b.name);
    default:
      return b.topViews - a.topViews;
  }
};

export const matchesFilters = (video: PublicVideo, filters: YouTubeFilters) => {
  if (filters.theme !== ALL_THEMES && !video.collections.includes(filters.theme)) return false;
  if (filters.style && video.styleFamily !== filters.style) return false;
  if (filters.channel && channelId(video) !== filters.channel) return false;
  if (filters.bestOnly && !video.isChannelBest) return false;
  const terms = (filters.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > 0) {
    const haystack = searchTextOf(video);
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  return true;
};

export const searchTextOf = (video: PublicVideo) =>
  [
    video.title,
    video.channelName,
    video.channelHandle,
    video.topic,
    video.styleFamily,
    video.styleDescription,
    video.format,
    video.whyItWorks,
    video.hook,
    video.collections.map((key) => themeLabel(key)).join(" "),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

// A video can sit in several themes; its "home" is the first by theme order.
export const homeTheme = (video: PublicVideo) =>
  [...video.collections].sort((a, b) => themeRank(a) - themeRank(b))[0] ?? "";

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Reads the page's filters from the query string. Unknown values fall back to
// the defaults, so a stale or hand-edited link never shows an empty page.
export const parseFilters = (params: Params, knownThemes: string[]): YouTubeFilters => {
  const rawTheme = one(params.theme);
  const theme =
    rawTheme === ALL_THEMES
      ? ALL_THEMES
      : rawTheme && knownThemes.includes(normalizeLabel(rawTheme))
        ? normalizeLabel(rawTheme)
        : knownThemes.includes(DEFAULT_THEME)
          ? DEFAULT_THEME
          : ALL_THEMES;
  const rawSort = one(params.sort);
  const view: YouTubeView = one(params.view) === "channels" ? "channels" : "videos";
  const sort =
    view === "channels"
      ? isChannelSort(rawSort)
        ? rawSort
        : DEFAULT_CHANNEL_SORT
      : isYouTubeSort(rawSort)
        ? rawSort
        : DEFAULT_SORT;
  return {
    view,
    theme,
    sort,
    style: one(params.style) || undefined,
    channel: one(params.channel) || undefined,
    query: one(params.q)?.trim() || undefined,
    bestOnly: one(params.best) === "1" ? true : undefined,
  };
};

// The inverse: only what differs from the defaults goes in the URL, so the
// plain link stays short.
export const filtersToSearch = (filters: YouTubeFilters) => {
  const search = new URLSearchParams();
  if (filters.view === "channels") search.set("view", "channels");
  if (filters.theme !== DEFAULT_THEME) search.set("theme", filters.theme);
  const defaultSort = filters.view === "channels" ? DEFAULT_CHANNEL_SORT : DEFAULT_SORT;
  if (filters.sort !== defaultSort) search.set("sort", filters.sort);
  if (filters.style) search.set("style", filters.style);
  if (filters.channel) search.set("channel", filters.channel);
  if (filters.query) search.set("q", filters.query);
  if (filters.bestOnly) search.set("best", "1");
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const countBy = <T>(items: T[], pick: (item: T) => string[]) => {
  const counts = new Map<string, number>();
  for (const item of items) for (const key of pick(item)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};
