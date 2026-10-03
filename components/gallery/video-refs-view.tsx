"use client";

/* eslint-disable @next/next/no-img-element -- R2 stills, sized by CSS */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Heart,
  MonitorPlay,
  Play,
  Search,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import {
  compareVideoRefs,
  formatCount,
  formatDuration,
  matchesVideoRef,
  youTubeEmbedUrl,
  type VideoRefSort,
} from "@/lib/video-refs";

type VideoRef = {
  _id: Id<"videoRefs">;
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
  agentDescription?: string;
  userNote?: string;
  collections: string[];
  tagNames: string[];
  thumbUrl?: string;
  frames: { url: string; label?: string }[];
  isLiked?: boolean;
  createdAt: number;
  updatedAt: number;
};

type VideoRefsViewProps = { ownerUserId: string };

const SORTS: { key: VideoRefSort; label: string }[] = [
  { key: "views", label: "Most views" },
  { key: "recent", label: "Most recent" },
  { key: "saved", label: "Last saved" },
];

const STYLE_CHIP_LIMIT = 18;

const formatDate = (value?: number) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

const searchTextOf = (video: VideoRef) =>
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
    video.titlePattern,
    video.thumbnailPattern,
    video.audience,
    video.bendIdea,
    video.agentDescription,
    video.userNote,
    video.collections.join(" "),
    video.tagNames.join(" "),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

const countBy = (videos: VideoRef[], pick: (video: VideoRef) => string[]) => {
  const counts = new Map<string, number>();
  for (const video of videos) {
    for (const key of pick(video)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

// The Videos tab: YouTube videos saved as research. Each card is one video
// with its channel numbers and the look it stands for; the detail view plays
// it and shows the stills copied at save time. Owner-only.
export function VideoRefsView({ ownerUserId }: VideoRefsViewProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<VideoRefSort>("views");
  const [collection, setCollection] = useState<string | null>(null);
  const [styleFamily, setStyleFamily] = useState<string | null>(null);
  const [onlyBest, setOnlyBest] = useState(false);
  const [onlyLiked, setOnlyLiked] = useState(false);
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useQuery(api.videoRefs.listVideoRefs, { ownerUserId, limit: 2000, sort: "views" }) as
    | VideoRef[]
    | undefined;

  const indexed = useMemo(
    () => (rows ?? []).map((video) => ({ ...video, searchText: searchTextOf(video) })),
    [rows],
  );

  const collections = useMemo(() => countBy(indexed, (video) => video.collections), [indexed]);
  // Style chips follow the collection, so they only offer looks that exist there.
  const styles = useMemo(
    () =>
      countBy(
        collection ? indexed.filter((video) => video.collections.includes(collection)) : indexed,
        (video) => (video.styleFamily ? [video.styleFamily] : []),
      ),
    [collection, indexed],
  );

  const visible = useMemo(
    () =>
      indexed
        .filter((video) =>
          matchesVideoRef(video, {
            collection: collection ?? undefined,
            styleFamily: styleFamily ?? undefined,
            search: query.trim() || undefined,
            onlyChannelBest: onlyBest,
            onlyLiked,
          }),
        )
        .sort(compareVideoRefs(sort)),
    [collection, indexed, onlyBest, onlyLiked, query, sort, styleFamily],
  );

  const filtering = Boolean(query.trim() || collection || styleFamily || onlyBest || onlyLiked);
  const open = openId ? indexed.find((video) => video._id === openId) ?? null : null;
  const openIndex = open ? visible.findIndex((video) => video._id === open._id) : -1;
  const visibleStyles = showAllStyles ? styles : styles.slice(0, STYLE_CHIP_LIMIT);

  return (
    <div className="vref-root w-full">
      <div className="skills-toolbar">
        <div className="skills-toolbar-head">
          <div className="skills-toolbar-title">
            <MonitorPlay className="h-3.5 w-3.5" style={{ color: "var(--coral)" }} />
            <span>Videos</span>
            <span className="skills-toolbar-count">
              {filtering && rows ? `${visible.length} / ` : ""}
              {rows?.length ?? "—"}
            </span>
          </div>
          <label className="skills-search">
            <Search className="h-3.5 w-3.5" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles, channels, styles, notes"
              aria-label="Search video references"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
          <div className="vref-sort" role="group" aria-label="Sort">
            {SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                data-active={sort === option.key}
                onClick={() => setSort(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {collections.length > 0 && (
          <div className="skills-chip-row" data-expanded="true">
            <button
              type="button"
              className="skills-chip"
              data-active={collection === null}
              onClick={() => {
                setCollection(null);
                setStyleFamily(null);
              }}
            >
              All
              <span className="skills-chip-count">{indexed.length}</span>
            </button>
            {collections.map((entry) => (
              <button
                key={entry.label}
                type="button"
                className="skills-chip"
                data-active={collection === entry.label}
                onClick={() => {
                  setCollection(collection === entry.label ? null : entry.label);
                  setStyleFamily(null);
                }}
              >
                {entry.label}
                <span className="skills-chip-count">{entry.count}</span>
              </button>
            ))}
            <span className="skills-chip-divider" aria-hidden />
            <button
              type="button"
              className="skills-chip"
              data-active={onlyBest}
              onClick={() => setOnlyBest((value) => !value)}
              title="Only each channel's best performer"
            >
              <Trophy className="h-2.5 w-2.5" aria-hidden /> Best per channel
            </button>
            <button
              type="button"
              className="skills-chip"
              data-active={onlyLiked}
              onClick={() => setOnlyLiked((value) => !value)}
            >
              <Heart className="h-2.5 w-2.5" aria-hidden /> Liked
            </button>
          </div>
        )}

        {styles.length > 0 && (
          <div className="skills-chip-row" data-expanded={showAllStyles}>
            {visibleStyles.map((entry) => (
              <button
                key={entry.label}
                type="button"
                className="skills-chip vref-style-chip"
                data-active={styleFamily === entry.label}
                onClick={() => setStyleFamily(styleFamily === entry.label ? null : entry.label)}
              >
                {entry.label}
                <span className="skills-chip-count">{entry.count}</span>
              </button>
            ))}
            {styles.length > STYLE_CHIP_LIMIT && (
              <button
                type="button"
                className="skills-chip skills-chip-more"
                onClick={() => setShowAllStyles((value) => !value)}
              >
                {showAllStyles ? "Fewer" : `+${styles.length - STYLE_CHIP_LIMIT} more`}
              </button>
            )}
          </div>
        )}
      </div>

      {rows === undefined ? (
        <div className="vref-grid" aria-busy>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="vref-card vref-card-skeleton" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center px-8 py-12 text-center lm-animate-fade-in">
          <MonitorPlay className="mb-4 h-7 w-7" style={{ color: "var(--coral)" }} />
          <h2 className="skills-empty-title">{filtering ? "No video matches" : "No videos yet"}</h2>
          <p className="skills-empty-copy">
            {filtering
              ? "Loosen a filter or search in other words."
              : "Ask an agent to save a YouTube video as a reference. It lands here with its frames, numbers and style notes."}
          </p>
        </div>
      ) : (
        <div className="vref-grid">
          {visible.map((video) => (
            <button
              key={video._id}
              type="button"
              className="vref-card"
              data-liked={video.isLiked ? "true" : undefined}
              onClick={() => setOpenId(video._id)}
            >
              <span className="vref-thumb">
                {video.thumbUrl ? (
                  <img src={video.thumbUrl} alt="" loading="lazy" />
                ) : (
                  <span className="vref-thumb-empty">No thumbnail</span>
                )}
                {video.frames.length > 0 && (
                  <span className="vref-thumb-frames" aria-hidden>
                    {video.frames.slice(0, 3).map((frame) => (
                      <img key={frame.url} src={frame.url} alt="" loading="lazy" />
                    ))}
                  </span>
                )}
                {video.isChannelBest && (
                  <span className="vref-badge vref-badge-best">
                    <Trophy className="h-2.5 w-2.5" /> Best
                  </span>
                )}
                {video.isLiked && (
                  <span className="vref-badge vref-badge-liked">
                    <Heart className="h-2.5 w-2.5" fill="currentColor" />
                  </span>
                )}
                {video.durationSeconds ? (
                  <span className="vref-duration">{formatDuration(video.durationSeconds)}</span>
                ) : null}
                <span className="vref-play" aria-hidden>
                  <Play className="h-4 w-4" fill="currentColor" />
                </span>
              </span>
              <span className="vref-body">
                <span className="vref-title">{video.title}</span>
                <span className="vref-meta">
                  <b>{formatCount(video.views)}</b> views
                  {video.publishedAt ? ` · ${formatDate(video.publishedAt)}` : ""}
                </span>
                <span className="vref-channel">
                  {video.channelName ?? video.channelHandle ?? "Unknown channel"}
                  {video.subscribers ? ` · ${formatCount(video.subscribers)} subs` : ""}
                </span>
                {video.styleFamily && <span className="vref-style">{video.styleFamily}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <VideoRefModal
          key={open._id}
          video={open}
          ownerUserId={ownerUserId}
          onClose={() => setOpenId(null)}
          onStep={(delta) => {
            const next = visible[openIndex + delta];
            if (next) setOpenId(next._id);
          }}
          hasPrevious={openIndex > 0}
          hasNext={openIndex >= 0 && openIndex < visible.length - 1}
        />
      )}
    </div>
  );
}

type VideoRefModalProps = {
  video: VideoRef;
  ownerUserId: string;
  onClose: () => void;
  onStep: (delta: number) => void;
  hasPrevious: boolean;
  hasNext: boolean;
};

const NOTE_ROWS: { key: keyof VideoRef; label: string }[] = [
  { key: "styleDescription", label: "The look" },
  { key: "whyItWorks", label: "Why it works" },
  { key: "format", label: "Format" },
  { key: "hook", label: "Hook" },
  { key: "titlePattern", label: "Title pattern" },
  { key: "thumbnailPattern", label: "Thumbnail pattern" },
  { key: "audience", label: "Who watches" },
  { key: "bendIdea", label: "Bend it" },
];

function VideoRefModal({ video, ownerUserId, onClose, onStep, hasPrevious, hasNext }: VideoRefModalProps) {
  const toast = useCoralToastSafe()?.toast;
  const updateVideoRef = useMutation(api.videoRefs.updateVideoRef);
  const deleteVideoRef = useMutation(api.videoRefs.deleteVideoRef);
  // null = the player; otherwise the still shown large in its place.
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState(video.userNote ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        if (event.key === "Escape") target.blur();
        return;
      }
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrevious) onStep(-1);
      if (event.key === "ArrowRight" && hasNext) onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasNext, hasPrevious, onClose, onStep]);

  const fail = (error: unknown) =>
    toast?.(
      "Failed",
      error instanceof Error ? error.message.toUpperCase() : "COULD NOT SAVE",
      "warning",
    );

  const stills = [
    ...(video.thumbUrl ? [{ url: video.thumbUrl, label: "Thumbnail" }] : []),
    ...video.frames.map((frame) => ({ url: frame.url, label: frame.label ?? "Frame" })),
  ];
  const ratio =
    video.medianViews && video.subscribers ? video.medianViews / video.subscribers : undefined;

  return (
    <div className="vref-modal" role="dialog" aria-modal="true" aria-label={video.title}>
      <button type="button" className="vref-modal-scrim" aria-label="Close" onClick={onClose} />
      <div className="vref-modal-panel">
        <div className="vref-modal-stage">
          <div className="vref-player">
            {stillUrl ? (
              <img src={stillUrl} alt="" />
            ) : playing ? (
              <iframe
                src={youTubeEmbedUrl(video.externalId, true)}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <button
                type="button"
                className="vref-player-poster"
                onClick={() => setPlaying(true)}
                aria-label="Play the video"
              >
                {video.thumbUrl ? <img src={video.thumbUrl} alt="" /> : null}
                <span className="vref-player-button">
                  <Play className="h-6 w-6" fill="currentColor" />
                </span>
              </button>
            )}
          </div>
          {stills.length > 0 && (
            <div className="vref-stills">
              <button
                type="button"
                className="vref-still vref-still-video"
                data-active={stillUrl === null}
                onClick={() => setStillUrl(null)}
              >
                <Play className="h-3.5 w-3.5" fill="currentColor" />
                <span>Video</span>
              </button>
              {stills.map((still) => (
                <button
                  key={still.url}
                  type="button"
                  className="vref-still"
                  data-active={stillUrl === still.url}
                  onClick={() => setStillUrl(still.url)}
                >
                  <img src={still.url} alt="" loading="lazy" />
                  <span>{still.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="vref-modal-side">
          <div className="vref-modal-top">
            <span className="vref-modal-kicker">
              {video.topic ?? "Video reference"}
              {video.isChannelBest ? " · channel best" : ""}
            </span>
            <button type="button" className="vref-icon-button" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="vref-modal-title">{video.title}</h2>
          <a
            className="vref-modal-channel"
            href={video.channelUrl ?? video.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {video.channelName ?? video.channelHandle ?? "Channel"}
            {video.channelHandle && video.channelName ? ` · ${video.channelHandle}` : ""}
            <ArrowUpRight className="h-3 w-3" />
          </a>

          <div className="vref-stats">
            <div>
              <b>{formatCount(video.views)}</b>
              <span>views</span>
            </div>
            <div>
              <b>{formatDate(video.publishedAt) || "–"}</b>
              <span>uploaded</span>
            </div>
            <div>
              <b>{formatCount(video.subscribers)}</b>
              <span>subscribers</span>
            </div>
            <div data-hot={ratio !== undefined && ratio >= 1 ? "true" : undefined}>
              <b>{formatCount(video.medianViews)}</b>
              <span>
                median views{ratio !== undefined ? ` · ${ratio.toFixed(ratio < 10 ? 2 : 0)}× subs` : ""}
              </span>
            </div>
          </div>

          {video.styleFamily && <span className="vref-style vref-style-large">{video.styleFamily}</span>}

          {NOTE_ROWS.map((row) => {
            const value = video[row.key];
            return typeof value === "string" && value ? (
              <p key={row.key} className="vref-note" data-kind={row.key}>
                <span>{row.label}</span>
                {value}
              </p>
            ) : null;
          })}

          {video.collections.length > 0 && (
            <div className="vref-chips">
              {video.collections.map((label) => (
                <span key={label}>{label}</span>
              ))}
              {video.tagNames.map((label) => (
                <span key={`tag-${label}`} data-tag>
                  #{label}
                </span>
              ))}
            </div>
          )}

          <textarea
            className="vref-user-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => {
              if (note.trim() === (video.userNote ?? "")) return;
              void updateVideoRef({ ownerUserId, id: video._id, userNote: note }).catch(fail);
            }}
            placeholder="Your note: what to take from this one"
            rows={2}
          />

          <div className="vref-actions">
            <button
              type="button"
              className="vref-action"
              data-active={video.isLiked ? "true" : undefined}
              onClick={() =>
                void updateVideoRef({ ownerUserId, id: video._id, isLiked: !video.isLiked }).catch(fail)
              }
            >
              <Heart className="h-3.5 w-3.5" fill={video.isLiked ? "currentColor" : "none"} />
              {video.isLiked ? "Liked" : "Like"}
            </button>
            <a className="vref-action" href={video.url} target="_blank" rel="noopener noreferrer">
              <ArrowUpRight className="h-3.5 w-3.5" /> YouTube
            </a>
            <button
              type="button"
              className="vref-action vref-action-danger"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                void deleteVideoRef({ ownerUserId, id: video._id })
                  .then(() => {
                    toast?.("Deleted", "VIDEO REFERENCE REMOVED", "success");
                    onClose();
                  })
                  .catch(fail);
              }}
              onBlur={() => setConfirmDelete(false)}
            >
              <Trash2 className="h-3.5 w-3.5" /> {confirmDelete ? "Click again to delete" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
