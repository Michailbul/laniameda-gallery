// Pure helpers for video references (the Videos tab). Shared by the Convex
// functions, the view and the agent scripts, so no React or Convex imports.

export type VideoRefSort = "views" | "recent" | "saved";

export type VideoRefFilter = {
  collection?: string;
  topic?: string;
  styleFamily?: string;
  productionStyle?: string;
  language?: string;
  // Every tag listed must be on the record.
  tagNames?: string[];
  channelHandle?: string;
  search?: string;
  onlyLiked?: boolean;
  onlyChannelBest?: boolean;
  minViews?: number;
  publishedAfter?: number;
};

export type VideoRefSortable = {
  views?: number;
  publishedAt?: number;
  createdAt: number;
  collections: string[];
  tagNames?: string[];
  topic?: string;
  styleFamily?: string;
  productionStyle?: string;
  language?: string;
  channelHandle?: string;
  searchText: string;
  isLiked?: boolean;
  isChannelBest?: boolean;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

// Accepts a bare id, watch?v=, youtu.be/, /shorts/, /embed/ and /live/ links.
export const parseYouTubeId = (input: string): string | null => {
  const value = input.trim();
  if (YOUTUBE_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const fromQuery = url.searchParams.get("v");
  if (fromQuery && YOUTUBE_ID.test(fromQuery)) return fromQuery;
  const [, kind, id] = url.pathname.split("/");
  if (["shorts", "embed", "live", "v"].includes(kind ?? "") && id && YOUTUBE_ID.test(id)) {
    return id;
  }
  return null;
};

export const youTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// The privacy-enhanced player: no cookies until the viewer presses play.
export const youTubeEmbedUrl = (id: string, autoplay = false) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0${autoplay ? "&autoplay=1" : ""}`;

// YouTube's own stills: the uploaded thumbnail, and three frames it captures
// at roughly 25, 50 and 75 percent of the video. Ordered best quality first.
export const youTubeThumbnailCandidates = (id: string) =>
  ["maxresdefault", "sddefault", "hqdefault"].map(
    (name) => `https://i.ytimg.com/vi/${id}/${name}.jpg`,
  );

export const youTubeFrameCandidates = (id: string, index: 1 | 2 | 3) =>
  [`maxres${index}`, `sd${index}`, `hq${index}`].map(
    (name) => `https://i.ytimg.com/vi/${id}/${name}.jpg`,
  );

export const normalizeLabel = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, "-");

export const buildVideoRefSearchText = (parts: Array<string | undefined | null>) =>
  parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" \n ")
    .toLowerCase();

export const matchesVideoRef = (row: VideoRefSortable, filter: VideoRefFilter) => {
  if (filter.collection && !row.collections.includes(normalizeLabel(filter.collection))) {
    return false;
  }
  if (filter.topic && normalizeLabel(row.topic ?? "") !== normalizeLabel(filter.topic)) {
    return false;
  }
  if (
    filter.styleFamily &&
    (row.styleFamily ?? "").trim().toLowerCase() !== filter.styleFamily.trim().toLowerCase()
  ) {
    return false;
  }
  if (
    filter.productionStyle &&
    (row.productionStyle ?? "").trim().toLowerCase() !== filter.productionStyle.trim().toLowerCase()
  ) {
    return false;
  }
  if (
    filter.language &&
    (row.language ?? "").trim().toLowerCase() !== filter.language.trim().toLowerCase()
  ) {
    return false;
  }
  if (filter.tagNames && filter.tagNames.length > 0) {
    const onRow = new Set((row.tagNames ?? []).map(normalizeLabel));
    const wanted = filter.tagNames.map(normalizeLabel).filter(Boolean);
    if (!wanted.every((tag) => onRow.has(tag))) return false;
  }
  if (
    filter.channelHandle &&
    (row.channelHandle ?? "").replace(/^@/, "").toLowerCase() !==
      filter.channelHandle.replace(/^@/, "").toLowerCase()
  ) {
    return false;
  }
  if (filter.onlyLiked && !row.isLiked) return false;
  if (filter.onlyChannelBest && !row.isChannelBest) return false;
  if (filter.minViews !== undefined && (row.views ?? 0) < filter.minViews) return false;
  if (filter.publishedAfter !== undefined && (row.publishedAt ?? 0) < filter.publishedAfter) {
    return false;
  }
  if (filter.search) {
    const terms = filter.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((term) => row.searchText.includes(term))) return false;
  }
  return true;
};

// "views" and "recent" fall back to the other key, so a tie never shuffles.
export const compareVideoRefs = (sort: VideoRefSort) =>
  (left: VideoRefSortable, right: VideoRefSortable) => {
    const views = (right.views ?? -1) - (left.views ?? -1);
    const recent = (right.publishedAt ?? 0) - (left.publishedAt ?? 0);
    const saved = right.createdAt - left.createdAt;
    if (sort === "views") return views || recent || saved;
    if (sort === "recent") return recent || views || saved;
    return saved || views;
  };

export const formatCount = (value?: number) => {
  if (value === undefined || value === null) return "–";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
};

export const formatDuration = (seconds?: number) => {
  if (!seconds) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
