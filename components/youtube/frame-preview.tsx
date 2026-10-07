/* eslint-disable @next/next/no-img-element -- storyboard tiles are cropped by CSS */
"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { formatDuration } from "@/lib/video-refs";
import type { PublicVideo } from "@/lib/youtube-page";
import type { YouTubeStoryboardFrame } from "@/lib/youtube-storyboards";

type PreviewFrame = Pick<YouTubeStoryboardFrame, "url"> & Partial<Omit<YouTubeStoryboardFrame, "url">>;

// Cards in Related and the thumbnail wall share requests. A consumer leaving
// cancels its update, not another card's request. The request itself is bounded.
const frameRequests = new Map<string, Promise<PreviewFrame[]>>();

function requestFrames(externalId: string) {
  const cached = frameRequests.get(externalId);
  if (cached) return cached;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const request = fetch(`/api/youtube/frames/${encodeURIComponent(externalId)}`, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) return [];
      const data = await response.json() as { frames?: PreviewFrame[] };
      return Array.isArray(data.frames) ? data.frames.filter((frame) =>
        typeof frame.url === "string" && /^https?:\/\//.test(frame.url) &&
        Number.isFinite(frame.columns) && (frame.columns ?? 0) > 0 &&
        Number.isFinite(frame.rows) && (frame.rows ?? 0) > 0 &&
        Number.isFinite(frame.column) && (frame.column ?? -1) >= 0 && (frame.column ?? 0) < (frame.columns ?? 0) &&
        Number.isFinite(frame.row) && (frame.row ?? -1) >= 0 && (frame.row ?? 0) < (frame.rows ?? 0)
      ) : [];
    })
    .catch(() => [])
    .finally(() => clearTimeout(timeout));
  frameRequests.set(externalId, request);
  return request;
}

export function useFramePreview(video: PublicVideo) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<PreviewFrame[]>([]);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const [reducedMotion, setReducedMotion] = useState(true);
  const pointerDown = useRef<number | null>(null);
  const scrubProgress = useRef<number | null>(null);
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const hintId = useId();
  const active = hovered || focused;
  const frames = useMemo<PreviewFrame[]>(() => {
    const available = loaded.filter((frame) => !failedUrls.has(frame.url));
    return available.length ? available : video.frames.filter((frame) => !failedUrls.has(frame.url)).map((frame) => ({ url: frame.url }));
  }, [loaded, video.frames, failedUrls]);

  useEffect(() => () => { if (scrubTimer.current) clearTimeout(scrubTimer.current); }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReducedMotion(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    requestFrames(video.externalId).then((next) => {
      if (!cancelled && next.length) {
        setLoaded(next);
        if (scrubProgress.current !== null) setIndex(Math.min(next.length - 1, Math.floor(scrubProgress.current * next.length)));
      }
    });
    return () => { cancelled = true; };
  }, [active, video.externalId]);

  useEffect(() => {
    if (!active || focused || scrubbing || reducedMotion || frames.length < 2) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % frames.length), 700);
    return () => clearInterval(timer);
  }, [active, focused, scrubbing, reducedMotion, frames.length]);

  function onPointerMove(event: PointerEvent<HTMLAnchorElement>) {
    if (event.pointerType === "touch") return;
    const surface = event.currentTarget.querySelector<HTMLElement>("[data-frame-surface]");
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientY > rect.bottom) return;
    if (pointerDown.current !== null && Math.abs(event.clientX - pointerDown.current) > 5) suppressClick.current = true;
    setScrubbing(true);
    if (scrubTimer.current) clearTimeout(scrubTimer.current);
    scrubTimer.current = setTimeout(() => setScrubbing(false), 1200);
    const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    scrubProgress.current = progress;
    setIndex(Math.min(frames.length - 1, Math.floor(progress * frames.length)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (!frames.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setScrubbing(true);
    setIndex((current) => event.key === "Home" ? 0 : event.key === "End" ? frames.length - 1 :
      (current + (event.key === "ArrowLeft" ? -1 : 1) + frames.length) % frames.length);
  }

  const frame = frames[Math.max(0, index) % Math.max(1, frames.length)];
  return {
    linkProps: {
      "aria-describedby": hintId,
      onPointerEnter: (event: PointerEvent<HTMLAnchorElement>) => {
        if (event.pointerType === "touch") return;
        scrubProgress.current = null;
        setHovered(true); setScrubbing(false); setIndex(0);
      },
      onPointerLeave: () => { setHovered(false); setScrubbing(false); pointerDown.current = null; },
      onPointerMove,
      onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => {
        pointerDown.current = event.clientX; suppressClick.current = false;
      },
      onPointerUp: () => { pointerDown.current = null; },
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (suppressClick.current && event.detail > 0) event.preventDefault();
        suppressClick.current = false;
      },
      onFocus: () => { setFocused(true); setIndex(0); },
      onBlur: () => { setFocused(false); setScrubbing(false); },
      onKeyDown,
    },
    preview: active && frame ? <FramePreview frame={frame} index={Math.max(0, index) % frames.length} count={frames.length} onImageError={() => setFailedUrls((current) => new Set([...current, frame.url]))} /> : null,
    hint: <span className="sr-only">
      <span id={hintId}>Preview frames on hover. When focused, use Left and Right arrows to skim, Home and End to jump, and Enter to open the video.</span>
      <span aria-live="polite">{focused && frame ? `Frame ${Math.max(0, index) % frames.length + 1} of ${frames.length}${frame.timeSeconds !== undefined ? ` at ${(formatDuration(frame.timeSeconds) || "0:00")}` : ""}` : ""}</span>
    </span>,
  };
}

function FramePreview({ frame, index, count, onImageError }: { frame: PreviewFrame; index: number; count: number; onImageError: () => void }) {
  const columns = frame.columns ?? 1;
  const rows = frame.rows ?? 1;
  const style: CSSProperties = {
    width: `${columns * 100}%`, height: `${rows * 100}%`,
    left: `${-(frame.column ?? 0) * 100}%`, top: `${-(frame.row ?? 0) * 100}%`,
  };
  return (
    <span className="yt-thumb-frames" aria-hidden="true">
      <img src={frame.url} alt="" loading="lazy" decoding="async" style={style} onError={onImageError} />
      <span className="yt-duration yt-frame-position">
        {frame.timeSeconds !== undefined ? `${(formatDuration(frame.timeSeconds) || "0:00")} · ` : ""}{index + 1}/{count}
      </span>
    </span>
  );
}
