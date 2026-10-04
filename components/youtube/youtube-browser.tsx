/* eslint-disable @next/next/no-img-element -- R2 stills, sized by CSS */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Search, Trophy, X } from "lucide-react";
import { formatCount } from "@/lib/video-refs";
import {
  ALL_THEMES,
  CHANNEL_SORTS,
  DEFAULT_CHANNEL_SORT,
  DEFAULT_SORT,
  DEFAULT_THUMB_SIZE,
  FITS_TAG,
  SINCE,
  SORTS,
  THEMES,
  THUMB_GROUPS,
  THUMB_SIZES,
  VIEWS,
  YOUTUBE_PATH,
  compareChannels,
  compareVideos,
  countBy,
  filtersToSearch,
  groupVideos,
  matchesFilters,
  summarizeChannels,
  themeLabel,
  themeRank,
  type ChannelSort,
  type ChannelSummary,
  type PublicVideo,
  type YouTubeFilters,
  type YouTubeSince,
  type YouTubeSort,
  type YouTubeView,
} from "@/lib/youtube-page";
import { CopyLinkButton } from "./copy-link-button";
import { ThumbTile } from "./thumb-tile";
import { VideoCard, formatDate } from "./video-card";

const STYLE_CHIP_LIMIT = 14;
// On the thumbnail wall the pictures are the point, so the style row stays on one line until asked.
const WALL_STYLE_CHIP_LIMIT = 6;

type Props = { videos: PublicVideo[]; initialFilters: YouTubeFilters };

// The public YouTube page: the saved channels and videos, car channels first.
// Filters and sort live in the URL (rewritten in place, no reload), so any view
// can be shared as a link.
export function YouTubeBrowser({ videos, initialFilters }: Props) {
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState(initialFilters.query ?? "");
  const [showAllStyles, setShowAllStyles] = useState(false);
  // One clock for the whole visit, so the upload window and the views-per-day
  // order do not shift between renders.
  const [now] = useState(() => Date.now());

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
  const madeWith = useMemo(
    () => countBy(inTheme, (video) => (video.productionStyle ? [video.productionStyle] : [])),
    [inTheme],
  );
  const hasFits = useMemo(() => inTheme.some((video) => video.tagNames.includes(FITS_TAG)), [inTheme]);
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
        .filter((video) => matchesFilters(video, filters, now))
        .sort(compareVideos(filters.sort as YouTubeSort, now)),
    [videos, filters, now],
  );

  const channels = useMemo(
    () =>
      summarizeChannels(videos.filter((video) => matchesFilters(video, { ...filters, channel: undefined }, now)))
        .sort(compareChannels(filters.sort as ChannelSort)),
    [videos, filters, now],
  );

  const channelView = filters.view === "channels";
  const thumbView = filters.view === "thumbnails";
  const thumbSize = filters.size ?? DEFAULT_THUMB_SIZE;
  const sortOptions = channelView ? CHANNEL_SORTS : SORTS;
  const styleChipLimit = thumbView ? WALL_STYLE_CHIP_LIMIT : STYLE_CHIP_LIMIT;
  const visibleStyles = showAllStyles ? styles : styles.slice(0, styleChipLimit);
  const refining = Boolean(
    filters.style ||
      filters.made ||
      filters.since ||
      filters.channel ||
      filters.query ||
      filters.bestOnly ||
      filters.fitsOnly,
  );
  const theme = THEMES.find((entry) => entry.key === filters.theme);
  const sections = useMemo(
    () => (thumbView && filters.group ? groupVideos(visible, filters.group) : null),
    [thumbView, filters.group, visible],
  );

  const pickTheme = (key: string) =>
    update({ theme: key, style: undefined, made: undefined, channel: undefined });
  // Videos and Thumbnails share their sorts, so the order survives the switch.
  // Channels sort by other things, and the wall's own controls stay on the wall.
  const pickView = (view: YouTubeView) =>
    update({
      view,
      sort:
        view === "channels"
          ? DEFAULT_CHANNEL_SORT
          : channelView
            ? DEFAULT_SORT
            : filters.sort,
      channel: view === "channels" ? undefined : filters.channel,
      size: view === "thumbnails" ? filters.size : undefined,
      group: view === "thumbnails" ? filters.group : undefined,
    });

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
          {VIEWS.map((view) => (
            <button
              key={view.key}
              type="button"
              data-active={filters.view === view.key}
              onClick={() => pickView(view.key)}
            >
              {view.label}
            </button>
          ))}
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

        <select
          className="yt-select"
          value={filters.since ?? ""}
          onChange={(event) => update({ since: (event.target.value || undefined) as YouTubeSince | undefined })}
          aria-label="Uploaded"
          title="Only videos uploaded in this window"
        >
          <option value="">Any upload date</option>
          {SINCE.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>

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

        {hasFits && (
          <button
            type="button"
            className="yt-chip"
            data-active={Boolean(filters.fitsOnly)}
            onClick={() => update({ fitsOnly: filters.fitsOnly ? undefined : true })}
            title="Channels that pass every check: still posting, faceless, in English, under 100K subscribers, 50K typical views, more than one hit"
          >
            <Check className="h-3 w-3" aria-hidden /> Passes our filters
          </button>
        )}
      </div>

      {madeWith.length > 0 && (
        <div className="yt-chips yt-made" aria-label="Made with">
          <span className="yt-control-label">Made with</span>
          {madeWith.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="yt-chip"
              data-kind="made"
              data-active={filters.made === entry.key}
              onClick={() => update({ made: filters.made === entry.key ? undefined : entry.key })}
            >
              {entry.key}
              <span>{entry.count}</span>
            </button>
          ))}
        </div>
      )}

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
          {styles.length > styleChipLimit && (
            <button type="button" className="yt-chip yt-chip-more" onClick={() => setShowAllStyles((value) => !value)}>
              {showAllStyles ? "Fewer" : `+${styles.length - styleChipLimit} more`}
            </button>
          )}
        </div>
      )}

      {thumbView && (
        <div className="yt-wall-controls">
          <span className="yt-control-label">Size</span>
          <div className="yt-segment yt-segment-small" role="group" aria-label="Thumbnail size">
            {THUMB_SIZES.map((option) => (
              <button
                key={option.key}
                type="button"
                data-active={thumbSize === option.key}
                title={option.hint}
                onClick={() => update({ size: option.key === DEFAULT_THUMB_SIZE ? undefined : option.key })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="yt-control-label">Group</span>
          <div className="yt-segment yt-segment-small" role="group" aria-label="Group thumbnails">
            <button type="button" data-active={!filters.group} onClick={() => update({ group: undefined })}>
              Off
            </button>
            {THUMB_GROUPS.map((option) => (
              <button
                key={option.key}
                type="button"
                data-active={filters.group === option.key}
                onClick={() => update({ group: option.key })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="yt-count" aria-live="polite">
        {channelView
          ? `${channels.length} channels`
          : `${visible.length} of ${inTheme.length} ${thumbView ? "thumbnails" : "videos"}`}
        {filters.channel ? ` · ${filters.channel}` : ""}
        {refining ? (
          <button
            type="button"
            className="yt-clear"
            onClick={() => {
              setQuery("");
              update({
                style: undefined,
                made: undefined,
                since: undefined,
                channel: undefined,
                query: undefined,
                bestOnly: undefined,
                fitsOnly: undefined,
              });
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
      ) : thumbView ? (
        sections ? (
          sections.map((section) => (
            <section key={section.key} className="yt-group">
              <header className="yt-group-head">
                <h2 className="yt-group-title">{section.label}</h2>
                <span className="yt-group-count">
                  {section.videos.length} {section.videos.length === 1 ? "thumbnail" : "thumbnails"} ·{" "}
                  {formatCount(section.videos.reduce((sum, video) => sum + (video.views ?? 0), 0))} views
                </span>
              </header>
              <div className="yt-wall" data-size={thumbSize}>
                {section.videos.map((video, index) => (
                  <ThumbTile key={video.externalId} video={video} rank={index + 1} size={thumbSize} now={now} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="yt-wall" data-size={thumbSize}>
            {visible.map((video, index) => (
              <ThumbTile key={video.externalId} video={video} rank={index + 1} size={thumbSize} now={now} />
            ))}
          </div>
        )
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
        {channel.lastUploadAt ? (
          <span className="yt-card-meta">Last upload {formatDate(channel.lastUploadAt)}</span>
        ) : null}
        {channel.made || channel.styles[0] ? (
          <span className="yt-card-tags">
            {channel.made ? (
              <span className="yt-tag" data-kind="made">
                {channel.made}
              </span>
            ) : null}
            {channel.styles[0] ? <span className="yt-tag">{channel.styles[0]}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}
