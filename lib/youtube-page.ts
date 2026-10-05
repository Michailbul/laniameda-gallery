// Pure helpers for the public YouTube page (/youtube). The page is a shareable
// view of the video references: every filter and the sort live in the URL, so a
// link opens the same slice.

import { normalizeLabel } from "./video-refs";

export const YOUTUBE_PATH = "/youtube";
export const youtubeVideoPath = (externalId: string) => `${YOUTUBE_PATH}/${externalId}`;

// Owner fields are included by the server only for Michael's signed-in session.
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
  bendIdea?: string;
  userNote?: string;
  isLiked?: boolean;
  // How the picture is made: "2D animation", "Stock footage", "AI pictures"…
  productionStyle?: string;
  language?: string;
  // The channel's latest upload and the day the numbers were re-read on YouTube.
  channelLastUploadAt?: number;
  checkedAt?: number;
  collections: string[];
  tagNames: string[];
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
  {
    key: "youtube-niche-bend",
    label: "Niche bend",
    blurb: "Titles and thumbnails that worked, kept to reuse on our own subjects.",
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

const ACRONYMS = new Set(["ai", "tv", "2d", "3d", "ufo", "wwii"]);

const titleize = (value: string) =>
  value
    .replace(/^youtube-/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ");

// "true-crime" → "True Crime": a topic as a tag or a section heading.
export const topicLabel = (topic: string) => titleize(topic);

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
  | "velocity"
  | "breakout"
  | "subscribers"
  | "longest"
  | "channel"
  | "title";

export const SORTS: { key: YouTubeSort; label: string; hint: string }[] = [
  { key: "views", label: "Most views", hint: "Highest view count first" },
  { key: "recent", label: "Newest", hint: "Latest upload first" },
  {
    key: "velocity",
    label: "Views per day",
    hint: "Views divided by days since upload: what is working right now",
  },
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

const DAY_MS = 24 * 60 * 60 * 1000;

// Views per day since upload. A video with no date has no rate, so it sinks.
// The first day counts as a whole one, so an hour-old upload does not win.
export const viewsPerDay = (video: PublicVideo, now: number) =>
  video.views !== undefined && video.publishedAt
    ? video.views / Math.max(1, (now - video.publishedAt) / DAY_MS)
    : -1;

// How many times its channel's typical upload a video reached. The proof that
// the title and thumbnail did the work, whatever the channel's size.
export const typicalMultiple = (video: PublicVideo) =>
  video.views !== undefined && video.medianViews ? video.views / video.medianViews : undefined;

// "19 d", "4 mo", "2 y": how long a video has been up, short enough for a tile.
export const formatAge = (publishedAt: number | undefined, now: number) => {
  if (!publishedAt) return "";
  const days = Math.max(0, Math.floor((now - publishedAt) / DAY_MS));
  if (days < 1) return "today";
  if (days < 60) return `${days} d`;
  if (days < 730) return `${Math.round(days / 30.4)} mo`;
  return `${Math.floor(days / 365)} y`;
};

const byViews = (a: PublicVideo, b: PublicVideo) => (b.views ?? -1) - (a.views ?? -1);

export const compareVideos = (sort: YouTubeSort, now = Date.now()) => (a: PublicVideo, b: PublicVideo) => {
  switch (sort) {
    case "recent":
      return (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || byViews(a, b);
    case "velocity":
      return viewsPerDay(b, now) - viewsPerDay(a, now) || byViews(a, b);
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

// "thumbnails" is the packaging wall: the thumbnail and the title as YouTube
// showed them, nothing laid over the picture.
export type YouTubeView = "videos" | "channels" | "thumbnails";

export const VIEWS: { key: YouTubeView; label: string }[] = [
  { key: "videos", label: "Videos" },
  { key: "thumbnails", label: "Thumbnails" },
  { key: "channels", label: "Channels" },
];

const isYouTubeView = (value: string | undefined): value is YouTubeView =>
  VIEWS.some((view) => view.key === value);

// Upload windows. Packaging goes stale fast, so "what works now" needs a cutoff.
export type YouTubeSince = "30d" | "90d" | "180d";

export const SINCE: { key: YouTubeSince; label: string; days: number }[] = [
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 3 months", days: 90 },
  { key: "180d", label: "Last 6 months", days: 180 },
];

const isSince = (value: string | undefined): value is YouTubeSince =>
  SINCE.some((entry) => entry.key === value);

// The thumbnail wall at three sizes: many at a glance, the default, or large
// with the title formula and the thumbnail layout written out.
export type ThumbSize = "wall" | "shelf" | "study";

export const THUMB_SIZES: { key: ThumbSize; label: string; hint: string }[] = [
  { key: "wall", label: "Wall", hint: "Small, as in YouTube's sidebar: does it read at a glance" },
  { key: "shelf", label: "Shelf", hint: "Thumbnail, title, numbers and tags" },
  { key: "study", label: "Study", hint: "Large, with the title formula and the thumbnail layout" },
];

export const DEFAULT_THUMB_SIZE: ThumbSize = "shelf";

const isThumbSize = (value: string | undefined): value is ThumbSize =>
  THUMB_SIZES.some((entry) => entry.key === value);

export type ThumbGroup = "made" | "topic";

export const THUMB_GROUPS: { key: ThumbGroup; label: string }[] = [
  { key: "made", label: "Made with" },
  { key: "topic", label: "Niche" },
];

const isThumbGroup = (value: string | undefined): value is ThumbGroup =>
  THUMB_GROUPS.some((entry) => entry.key === value);

// The tag an agent puts on a video whose channel passes every check we run
// (alive, median, size, faceless). The page offers it as one switch.
export const FITS_TAG = "passes-filters";

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
  made?: string; // productionStyle
  since?: YouTubeSince;
  channel?: string; // channel handle or name, as shown in the URL
  query?: string;
  bestOnly?: boolean;
  fitsOnly?: boolean;
  ideasOnly?: boolean;
  // Thumbnails view only.
  size?: ThumbSize;
  group?: ThumbGroup;
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
  made?: string;
  lastUploadAt?: number;
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
      made: countBy(sorted, (video) => (video.productionStyle ? [video.productionStyle] : []))[0]?.key,
      lastUploadAt: sorted.reduce<number | undefined>(
        (latest, video) =>
          video.channelLastUploadAt && video.channelLastUploadAt > (latest ?? 0)
            ? video.channelLastUploadAt
            : latest,
        undefined,
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

export const matchesFilters = (video: PublicVideo, filters: YouTubeFilters, now = Date.now()) => {
  if (filters.theme !== ALL_THEMES && !video.collections.includes(filters.theme)) return false;
  if (filters.style && video.styleFamily !== filters.style) return false;
  if (filters.made && video.productionStyle !== filters.made) return false;
  if (filters.since) {
    const days = SINCE.find((entry) => entry.key === filters.since)?.days ?? 0;
    if (!video.publishedAt || video.publishedAt < now - days * DAY_MS) return false;
  }
  if (filters.fitsOnly && !video.tagNames.includes(FITS_TAG)) return false;
  if (filters.ideasOnly && !video.bendIdea?.trim()) return false;
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
    video.productionStyle,
    video.styleDescription,
    video.format,
    video.whyItWorks,
    video.hook,
    video.titlePattern,
    video.thumbnailPattern,
    video.bendIdea,
    video.userNote,
    video.tagNames.join(" "),
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
  const rawView = one(params.view);
  const view: YouTubeView = isYouTubeView(rawView) ? rawView : "videos";
  const rawSince = one(params.since);
  const rawSize = one(params.size);
  const rawGroup = one(params.group);
  const thumbnails = view === "thumbnails";
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
    made: one(params.made) || undefined,
    since: isSince(rawSince) ? rawSince : undefined,
    channel: one(params.channel) || undefined,
    query: one(params.q)?.trim() || undefined,
    bestOnly: one(params.best) === "1" ? true : undefined,
    fitsOnly: one(params.fits) === "1" ? true : undefined,
    ideasOnly: one(params.ideas) === "1" ? true : undefined,
    size: thumbnails && isThumbSize(rawSize) && rawSize !== DEFAULT_THUMB_SIZE ? rawSize : undefined,
    group: thumbnails && isThumbGroup(rawGroup) ? rawGroup : undefined,
  };
};

// The inverse: only what differs from the defaults goes in the URL, so the
// plain link stays short.
export const filtersToSearch = (filters: YouTubeFilters) => {
  const search = new URLSearchParams();
  if (filters.view !== "videos") search.set("view", filters.view);
  if (filters.theme !== DEFAULT_THEME) search.set("theme", filters.theme);
  const defaultSort = filters.view === "channels" ? DEFAULT_CHANNEL_SORT : DEFAULT_SORT;
  if (filters.sort !== defaultSort) search.set("sort", filters.sort);
  if (filters.style) search.set("style", filters.style);
  if (filters.made) search.set("made", filters.made);
  if (filters.since) search.set("since", filters.since);
  if (filters.channel) search.set("channel", filters.channel);
  if (filters.query) search.set("q", filters.query);
  if (filters.bestOnly) search.set("best", "1");
  if (filters.fitsOnly) search.set("fits", "1");
  if (filters.ideasOnly) search.set("ideas", "1");
  if (filters.view === "thumbnails") {
    if (filters.size && filters.size !== DEFAULT_THUMB_SIZE) search.set("size", filters.size);
    if (filters.group) search.set("group", filters.group);
  }
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

// The thumbnail wall in sections: one per way of making the picture, or one per
// niche. Videos with no label go last, under their own heading.
export const groupVideos = (videos: PublicVideo[], group: ThumbGroup) => {
  const UNLABELLED = "Not labelled";
  const sections = new Map<string, PublicVideo[]>();
  for (const video of videos) {
    const key = (group === "made" ? video.productionStyle : video.topic) || UNLABELLED;
    sections.set(key, [...(sections.get(key) ?? []), video]);
  }
  return [...sections.entries()]
    .map(([key, items]) => ({ key, label: group === "topic" && key !== UNLABELLED ? titleize(key) : key, videos: items }))
    .sort(
      (a, b) =>
        Number(a.key === UNLABELLED) - Number(b.key === UNLABELLED) ||
        b.videos.length - a.videos.length ||
        a.key.localeCompare(b.key),
    );
};
