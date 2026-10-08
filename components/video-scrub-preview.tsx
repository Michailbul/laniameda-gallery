"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createVideoScrubber } from "@/lib/video-scrub";

export function useVideoScrub({ enabled = true, delayMs = 250 } = {}) {
  const [active, setActive] = useState(false);
  const progress = useRef(0);
  const seek = useRef<((progress: number) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bounds = useRef<{ left: number; width: number } | null>(null);

  const cancel = useCallback(function cancelPreview() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    bounds.current = null;
    window.removeEventListener("scroll", cancelPreview, true);
    window.removeEventListener("resize", cancelPreview);
    document.removeEventListener("visibilitychange", cancelPreview);
    setActive(false);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    window.removeEventListener("scroll", cancel, true);
    window.removeEventListener("resize", cancel);
    document.removeEventListener("visibilitychange", cancel);
  }, [cancel]);

  const update = useCallback((event: PointerEvent<HTMLElement>) => {
    const rect = bounds.current;
    if (!rect || rect.width <= 0) return;
    progress.current = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seek.current?.(progress.current);
  }, []);

  const enter = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType === "touch") return;
    cancel();
    bounds.current = event.currentTarget.getBoundingClientRect();
    update(event);
    window.addEventListener("scroll", cancel, { capture: true, passive: true });
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", cancel);
    timer.current = setTimeout(() => {
      timer.current = null;
      setActive(true);
    }, Math.max(0, delayMs));
  }, [cancel, delayMs, enabled, update]);

  const move = useCallback((event: PointerEvent<HTMLElement>) => {
    // A scroll cancels the preview even if the card stays under the pointer.
    // Deliberate pointer movement can start it again without leaving the tile.
    if (!bounds.current) enter(event);
    else update(event);
  }, [enter, update]);

  return {
    active: enabled && active,
    progress,
    seek,
    handlers: {
      onPointerEnter: enter,
      onPointerMove: move,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
    },
  };
}

export type VideoScrubState = ReturnType<typeof useVideoScrub>;

/** A paused video whose bytes are requested only when its owner mounts it. */
export function VideoScrubPreview({
  src, poster, scrub, className, onLoadedData, onError,
}: {
  src: string;
  poster?: string;
  scrub: VideoScrubState;
  className?: string;
  onLoadedData?: () => void;
  onError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { active, progress: progressRef, seek: seekRef } = scrub;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const controller = createVideoScrubber(video);
    video.pause();
    const update = () => {
      if (active || !poster) controller.seek(active ? progressRef.current : 0);
    };
    if (active) seekRef.current = controller.seek;
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("seeked", update);
    if (active || !poster) update();
    return () => {
      if (seekRef.current === controller.seek) seekRef.current = null;
      controller.dispose();
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("seeked", update);
      video.pause();
    };
  }, [active, poster, progressRef, seekRef, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.getAttribute("src") !== src) video.src = src;
    return () => {
      if (video.getAttribute("src") === src) {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      muted
      playsInline
      preload="metadata"
      className={className}
      style={{ visibility: poster && !active ? "hidden" : undefined }}
      aria-hidden
      onLoadedData={onLoadedData}
      onError={onError}
    />
  );
}
