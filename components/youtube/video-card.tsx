/* eslint-disable @next/next/no-img-element -- R2 stills, sized by CSS */
"use client";

import Link from "next/link";
import { Play, Trophy } from "lucide-react";
import { formatCount, formatDuration } from "@/lib/video-refs";
import { themeLabel, youtubeVideoPath, homeTheme, styleLabel, type PublicVideo } from "@/lib/youtube-page";
import { CopyLinkButton } from "./copy-link-button";
import { useFramePreview } from "./frame-preview";

export const formatDate = (value?: number) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

export function VideoCard({ video, showTheme }: { video: PublicVideo; showTheme?: boolean }) {
  const href = youtubeVideoPath(video.externalId);
  const preview = useFramePreview(video);
  return (
    <article className="yt-card">
      <Link href={href} className="yt-card-link" aria-label={video.title} {...preview.linkProps}>
        <span className="yt-thumb" data-frame-surface>
          {video.thumbUrl ? <img src={video.thumbUrl} alt="" loading="lazy" /> : null}
          {preview.preview}
          {video.isChannelBest && (
            <span className="yt-badge">
              <Trophy className="h-2.5 w-2.5" /> Best
            </span>
          )}
          {video.durationSeconds && !preview.preview ? (
            <span className="yt-duration">{formatDuration(video.durationSeconds)}</span>
          ) : null}
          {!preview.preview && <span className="yt-play" aria-hidden>
            <Play className="h-4 w-4" fill="currentColor" />
          </span>}
        </span>
        <span className="yt-card-body">
          <span className="yt-card-title">{video.title}</span>
          <span className="yt-card-meta">
            <b>{formatCount(video.views)}</b> views
            {video.publishedAt ? ` · ${formatDate(video.publishedAt)}` : ""}
          </span>
          <span className="yt-card-channel">
            {video.channelName ?? video.channelHandle ?? "Unknown channel"}
            {video.subscribers ? ` · ${formatCount(video.subscribers)} subs` : ""}
          </span>
          <span className="yt-card-tags">
            {showTheme && homeTheme(video) ? (
              <span className="yt-tag" data-kind="theme">
                {themeLabel(homeTheme(video))}
              </span>
            ) : null}
            {styleLabel(video.styleFamily) ? <span className="yt-tag">{styleLabel(video.styleFamily)}</span> : null}
          </span>
        </span>
        {preview.hint}
      </Link>
      <CopyLinkButton path={href} label="Copy link to this video" className="yt-card-copy" iconOnly />
    </article>
  );
}
