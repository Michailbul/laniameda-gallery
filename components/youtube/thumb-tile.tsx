/* eslint-disable @next/next/no-img-element -- R2 stills, sized by CSS */
"use client";

import Link from "next/link";
import { formatCount } from "@/lib/video-refs";
import {
  formatAge,
  topicLabel,
  typicalMultiple,
  youtubeVideoPath,
  styleLabel,
  type PublicVideo,
  type ThumbSize,
} from "@/lib/youtube-page";

import { useFramePreview } from "./frame-preview";

// One thumbnail on the packaging wall. The picture is shown as the viewer saw
// it until hover reveals the video frames, and the title keeps its capitals: both are
// what won the click. Numbers and tags sit underneath.
export function ThumbTile({
  video,
  rank,
  size,
  now,
}: {
  video: PublicVideo;
  rank: number;
  size: ThumbSize;
  now: number;
}) {
  const preview = useFramePreview(video);
  const multiple = typicalMultiple(video);
  const age = formatAge(video.publishedAt, now);
  return (
    <Link href={youtubeVideoPath(video.externalId)} className="yt-tile" aria-label={video.title} {...preview.linkProps}>
      <span className="yt-tile-img" data-frame-surface>
        {video.thumbUrl ? <img src={video.thumbUrl} alt="" loading="lazy" /> : null}
        {preview.preview}
      </span>
      <span className="yt-tile-title">{video.title}</span>
      {size === "study" && video.titlePattern ? (
        <span className="yt-tile-formula">{video.titlePattern}</span>
      ) : null}
      {size === "study" && video.thumbnailPattern ? (
        <span className="yt-tile-layout">{video.thumbnailPattern}</span>
      ) : null}
      <span className="yt-tile-meta">
        <span className="yt-tile-rank" data-top={rank <= 3 || undefined}>
          {String(rank).padStart(2, "0")}
        </span>
        <span>
          <b>{formatCount(video.views)}</b>
          {size === "wall" ? "" : " views"}
        </span>
        {age ? <span>{age}</span> : null}
        {multiple !== undefined && multiple >= 1.5 ? (
          <span
            className="yt-tile-multiple"
            data-hot={multiple >= 5 || undefined}
            title="Views against the channel's typical upload"
          >
            ×{multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}
            {size === "wall" ? "" : " typical"}
          </span>
        ) : null}
      </span>
      {size !== "wall" ? (
        <span className="yt-tile-channel">
          {video.channelName ?? video.channelHandle ?? "Unknown channel"}
          {video.subscribers ? ` · ${formatCount(video.subscribers)} subs` : ""}
        </span>
      ) : null}
      {size !== "wall" && (video.topic || video.styleFamily) ? (
        <span className="yt-card-tags">
          {video.topic ? <span className="yt-tag">{topicLabel(video.topic)}</span> : null}
          {styleLabel(video.styleFamily) ? <span className="yt-tag">{styleLabel(video.styleFamily)}</span> : null}
        </span>
      ) : null}
      {preview.hint}
    </Link>
  );
}
