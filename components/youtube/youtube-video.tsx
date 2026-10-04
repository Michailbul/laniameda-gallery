/* eslint-disable @next/next/no-img-element -- R2 stills, sized by CSS */
"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, Play } from "lucide-react";
import { formatCount, youTubeEmbedUrl } from "@/lib/video-refs";
import {
  YOUTUBE_PATH,
  compareVideos,
  homeTheme,
  channelId,
  themeLabel,
  youtubeVideoPath,
  type PublicVideo,
} from "@/lib/youtube-page";
import { CopyLinkButton } from "./copy-link-button";
import { VideoCard, formatDate } from "./video-card";

const NOTE_ROWS: { key: keyof PublicVideo; label: string }[] = [
  { key: "styleDescription", label: "The look" },
  { key: "whyItWorks", label: "Why it works" },
  { key: "format", label: "Format" },
  { key: "hook", label: "Hook" },
  { key: "titlePattern", label: "Title pattern" },
  { key: "thumbnailPattern", label: "Thumbnail pattern" },
  { key: "audience", label: "Who watches" },
];

const RELATED_LIMIT = 6;

// One video on its own URL: the link to share. The same page plays it, shows
// the stills and the analysis, and offers more from the channel and the theme.
export function YouTubeVideoPage({ video, videos }: { video: PublicVideo; videos: PublicVideo[] }) {
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const theme = homeTheme(video);
  const stills = [
    ...(video.thumbUrl ? [{ url: video.thumbUrl, label: "Thumbnail" }] : []),
    ...video.frames.map((frame) => ({ url: frame.url, label: frame.label ?? "Frame" })),
  ];
  const ratio = video.medianViews && video.subscribers ? video.medianViews / video.subscribers : undefined;
  const channel = channelId(video);

  const fromChannel = videos
    .filter((entry) => entry.externalId !== video.externalId && channel && channelId(entry) === channel)
    .sort(compareVideos("views"))
    .slice(0, RELATED_LIMIT);
  const shown = new Set([video.externalId, ...fromChannel.map((entry) => entry.externalId)]);
  const fromTheme = videos
    .filter((entry) => !shown.has(entry.externalId) && theme && entry.collections.includes(theme))
    .sort(compareVideos("views"))
    .slice(0, RELATED_LIMIT);

  const backHref = theme ? `${YOUTUBE_PATH}?theme=${theme}` : YOUTUBE_PATH;

  return (
    <main className="yt-page yt-video">
      <div className="yt-video-bar">
        <Link href={backHref} className="yt-button">
          <ArrowLeft className="h-3.5 w-3.5" /> {theme ? themeLabel(theme) : "YouTube"}
        </Link>
        <CopyLinkButton label="Copy link" path={youtubeVideoPath(video.externalId)} />
      </div>

      <div className="yt-video-layout">
        <section className="yt-video-stage">
          <div className="yt-player">
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
              <button type="button" className="yt-player-poster" onClick={() => setPlaying(true)} aria-label="Play the video">
                {video.thumbUrl ? <img src={video.thumbUrl} alt="" /> : null}
                <span className="yt-player-button">
                  <Play className="h-6 w-6" fill="currentColor" />
                </span>
              </button>
            )}
          </div>
          {stills.length > 0 && (
            <div className="yt-stills">
              <button type="button" className="yt-still yt-still-video" data-active={stillUrl === null} onClick={() => setStillUrl(null)}>
                <Play className="h-3.5 w-3.5" fill="currentColor" />
                <span>Video</span>
              </button>
              {stills.map((still) => (
                <button
                  key={still.url}
                  type="button"
                  className="yt-still"
                  data-active={stillUrl === still.url}
                  onClick={() => setStillUrl(still.url)}
                >
                  <img src={still.url} alt="" loading="lazy" />
                  <span>{still.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="yt-video-side">
          <span className="yt-kicker">
            {theme ? themeLabel(theme) : "Video"}
            {video.isChannelBest ? " · channel best" : ""}
          </span>
          <h1 className="yt-video-title">{video.title}</h1>
          <a className="yt-video-channel" href={video.channelUrl ?? video.url} target="_blank" rel="noopener noreferrer">
            {video.channelName ?? video.channelHandle ?? "Channel"}
            {video.channelHandle && video.channelName ? ` · ${video.channelHandle}` : ""}
            <ArrowUpRight className="h-3 w-3" />
          </a>

          <div className="yt-stats">
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
              <span>typical views{ratio !== undefined ? ` · ${ratio.toFixed(ratio < 10 ? 2 : 0)}× subs` : ""}</span>
            </div>
          </div>

          {video.productionStyle || video.styleFamily ? (
            <span className="yt-card-tags">
              {video.productionStyle ? (
                <span className="yt-tag yt-tag-large" data-kind="made">
                  {video.productionStyle}
                </span>
              ) : null}
              {video.styleFamily ? <span className="yt-tag yt-tag-large">{video.styleFamily}</span> : null}
            </span>
          ) : null}

          {NOTE_ROWS.map((row) => {
            const value = video[row.key];
            return typeof value === "string" && value ? (
              <p key={row.key} className="yt-note">
                <span>{row.label}</span>
                {value}
              </p>
            ) : null;
          })}

          {video.checkedAt || video.channelLastUploadAt ? (
            <p className="yt-checked">
              {video.checkedAt ? `Numbers checked ${formatDate(video.checkedAt)}` : ""}
              {video.checkedAt && video.channelLastUploadAt ? " · " : ""}
              {video.channelLastUploadAt ? `channel last uploaded ${formatDate(video.channelLastUploadAt)}` : ""}
            </p>
          ) : null}

          <a className="yt-button" href={video.url} target="_blank" rel="noopener noreferrer">
            <ArrowUpRight className="h-3.5 w-3.5" /> Watch on YouTube
          </a>
        </section>
      </div>

      {fromChannel.length > 0 && (
        <Related title={`More from ${video.channelName ?? video.channelHandle}`} videos={fromChannel} />
      )}
      {fromTheme.length > 0 && theme && <Related title={`More in ${themeLabel(theme)}`} videos={fromTheme} />}
    </main>
  );
}

function Related({ title, videos }: { title: string; videos: PublicVideo[] }) {
  return (
    <section className="yt-related">
      <h2 className="yt-subtitle">{title}</h2>
      <div className="yt-grid">
        {videos.map((entry) => (
          <VideoCard key={entry.externalId} video={entry} />
        ))}
      </div>
    </section>
  );
}
