/* eslint-disable @next/next/no-img-element -- R2 stills, sized by CSS */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Trophy, X } from "lucide-react";
import { formatCount } from "@/lib/video-refs";
import {
  ALL_THEMES,
  CHANNEL_SORTS,
  DEFAULT_CHANNEL_SORT,
  DEFAULT_SORT,
  SORTS,
  THEMES,
  YOUTUBE_PATH,
  compareChannels,
  compareVideos,
  countBy,
  filtersToSearch,
  matchesFilters,
  summarizeChannels,
  themeLabel,
  themeRank,
  type ChannelSort,
  type ChannelSummary,
  type PublicVideo,
  type YouTubeFilters,
  type YouTubeSort,
} from "@/lib/youtube-page";
import { CopyLinkButton } from "./copy-link-button";
import { VideoCard } from "./video-card";

const STYLE_CHIP_LIMIT = 14;

type Props = { videos: PublicVideo[]; initialFilters: YouTubeFilters };

// The public YouTube page: the saved channels and videos, car channels first.
// Filters and sort live in the URL (rewritten in place, no reload), so any view
// can be shared as a link.
export function YouTubeBrowser({ videos, initialFilters }: Props) {
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState(initialFilters.query ?? "");
  const [showAllStyles, setShowAllStyles] = useState(false);

  // Typing updates the list after a beat, so the URL is not rewritten per key.
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((current) => ({ ...current, query: query.trim() || undefined })),
      180,
    );
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    window.history.replaceState(null, "", `${YOUTUBE_PATH}${filtersToSearch(filters)}`);
  }, [filters]);

  const update = useCallback((patch: Partial<YouTubeFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  const themes = useMemo(() => {
    const counts = countBy(videos, (video) => video.collections);
    return counts.sort((a, b) => themeRank(a.key) - themeRank(b.key) || b.count - a.count);
  }, [videos]);

  const inTheme = useMemo(
    () => videos.filter((video) => filters.theme === ALL_THEMES || video.collections.includes(filters.theme)),
    [videos, filters.theme],
  );

  // Style and channel options follow the theme, so they only offer what exists there.
  const styles = useMemo(
    () => countBy(inTheme, (video) => (video.styleFamily ? [video.styleFamily] : [])),
    [inTheme],
  );
  const channelOptions = useMemo(
    () =>
      summarizeChannels(inTheme)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((channel) => ({ id: channel.id, label: `${channel.name} (${channel.videos.length})` })),
    [inTheme],
  );

  const visible = useMemo(
    () =>
      videos
        .filter((video) => matchesFilters(video, filters))
        .sort(compareVideos(filters.sort as YouTubeSort)),
    [videos, filters],
  );

  const channels = useMemo(
    () =>
      summarizeChannels(videos.filter((video) => matchesFilters(video, { ...filters, channel: undefined })))
        .sort(compareChannels(filters.sort as ChannelSort)),
    [videos, filters],
  );

  const channelView = filters.view === "channels";
  const sortOptions = channelView ? CHANNEL_SORTS : SORTS;
  const visibleStyles = showAllStyles ? styles : styles.slice(0, STYLE_CHIP_LIMIT);
  const refining = Boolean(filters.style || filters.channel || filters.query || filters.bestOnly);
  const theme = THEMES.find((entry) => entry.key === filters.theme);

  const pickTheme = (key: string) => update({ theme: key, style: undefined, channel: undefined });
  const pickView = (view: "videos" | "channels") =>
    update({ view, sort: view === "channels" ? DEFAULT_CHANNEL_SORT : DEFAULT_SORT, channel: undefined });

  const openChannel = (channel: ChannelSummary) => update({ view: "videos", sort: DEFAULT_SORT, channel: channel.id });

  return (
    <main className="yt-page">
      <header className="yt-header">
        <div>
          <h1 className="yt-title">YouTube</h1>
          <p className="yt-lede">
            {videos.length} videos from {summarizeChannels(videos).length} channels. {theme?.blurb ?? "Everything, across every theme."}
          </p>
        </div>
        <CopyLinkButton
          label="Copy link to this view"
          path={() => `${YOUTUBE_PATH}${filtersToSearch(filters)}`}
        />
      </header>

      <nav className="yt-themes" aria-label="Themes">
        {themes.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="yt-theme"
            data-active={filters.theme === entry.key}
            data-primary={themeRank(entry.key) === 0 || undefined}
            onClick={() => pickTheme(entry.key)}
          >
            {themeLabel(entry.key)}
            <span>{entry.count}</span>
          </button>
        ))}
        <button
          type="button"
          className="yt-theme"
          data-active={filters.theme === ALL_THEMES}
          onClick={() => pickTheme(ALL_THEMES)}
        >
          All
          <span>{videos.length}</span>
        </button>
      </nav>

      <div className="yt-toolbar">
        <div className="yt-segment" role="group" aria-label="View">
          <button type="button" data-active={!channelView} onClick={() => pickView("videos")}>
            Videos
          </button>
          <button type="button" data-active={channelView} onClick={() => pickView("channels")}>
            Channels
          </button>
        </div>

        <label className="yt-search">
          <Search className="h-3.5 w-3.5" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, channels, styles"
            aria-label="Search"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X className="h-3 w-3" />
            </button>
          )}
        </label>

        {!channelView && channelOptions.length > 1 && (
          <select
            className="yt-select"
            value={filters.channel ?? ""}
            onChange={(event) => update({ channel: event.target.value || undefined })}
            aria-label="Channel"
          >
            <option value="">All channels</option>
            {channelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        <label className="yt-sort">
          <span>Sort</span>
          <select
            className="yt-select"
            value={filters.sort}
            onChange={(event) => update({ sort: event.target.value as YouTubeSort })}
            aria-label="Sort"
            title={sortOptions.find((option) => option.key === filters.sort)?.hint}
          >
            {sortOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="yt-chip"
          data-active={Boolean(filters.bestOnly)}
          onClick={() => update({ bestOnly: filters.bestOnly ? undefined : true })}
          title="Only each channel's best performer"
        >
          <Trophy className="h-3 w-3" aria-hidden /> Best per channel
        </button>
      </div>

      {styles.length > 1 && (
        <div className="yt-chips" aria-label="Styles">
          {visibleStyles.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="yt-chip"
              data-active={filters.style === entry.key}
              onClick={() => update({ style: filters.style === entry.key ? undefined : entry.key })}
            >
              {entry.key}
              <span>{entry.count}</span>
            </button>
          ))}
          {styles.length > STYLE_CHIP_LIMIT && (
            <button type="button" className="yt-chip yt-chip-more" onClick={() => setShowAllStyles((value) => !value)}>
              {showAllStyles ? "Fewer" : `+${styles.length - STYLE_CHIP_LIMIT} more`}
            </button>
          )}
        </div>
      )}

      <p className="yt-count" aria-live="polite">
        {channelView ? `${channels.length} channels` : `${visible.length} of ${inTheme.length} videos`}
        {filters.channel ? ` · ${filters.channel}` : ""}
        {refining ? (
          <button
            type="button"
            className="yt-clear"
            onClick={() => {
              setQuery("");
              update({ style: undefined, channel: undefined, query: undefined, bestOnly: undefined });
            }}
          >
            Clear filters
          </button>
        ) : null}
      </p>

      {channelView ? (
        channels.length === 0 ? (
          <Empty />
        ) : (
          <div className="yt-channel-grid">
            {channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} onOpen={() => openChannel(channel)} />
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <Empty />
      ) : (
        <div className="yt-grid">
          {visible.map((video) => (
            <VideoCard key={video.externalId} video={video} showTheme={filters.theme === ALL_THEMES} />
          ))}
        </div>
      )}
    </main>
  );
}

function Empty() {
  return (
    <div className="yt-empty">
      <h2 className="yt-subtitle">Nothing matches</h2>
      <p>Loosen a filter or search in other words.</p>
    </div>
  );
}

function ChannelCard({ channel, onOpen }: { channel: ChannelSummary; onOpen: () => void }) {
  const stills = channel.videos.slice(0, 3);
  return (
    <button type="button" className="yt-channel" onClick={onOpen}>
      <span className="yt-channel-stills" aria-hidden>
        {stills.map((video) =>
          video.thumbUrl ? <img key={video.externalId} src={video.thumbUrl} alt="" loading="lazy" /> : <span key={video.externalId} />,
        )}
      </span>
      <span className="yt-channel-body">
        <span className="yt-card-title">{channel.name}</span>
        <span className="yt-card-meta">
          {channel.handle ?? ""}
          {channel.subscribers ? `${channel.handle ? " · " : ""}${formatCount(channel.subscribers)} subs` : ""}
        </span>
        <span className="yt-channel-stats">
          <span>
            <b>{channel.videos.length}</b> {channel.videos.length === 1 ? "video" : "videos"}
          </span>
          <span>
            <b>{formatCount(channel.topViews)}</b> top
          </span>
          {channel.medianViews ? (
            <span>
              <b>{formatCount(channel.medianViews)}</b> typical
            </span>
          ) : null}
        </span>
        {channel.styles[0] ? <span className="yt-tag">{channel.styles[0]}</span> : null}
      </span>
    </button>
  );
}
