"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HeroRotation } from "./world-brand";
import { WorldLayers } from "./world-layers";

// The opening takes turns through several layered frames. Only the frame on
// screen and the one after it are mounted: the next one loads while the
// current one holds, then crossfades in. The first frame is server-rendered
// and traces the mark; the rest arrive once the page has settled. Turns pause
// while the hero is off screen, the tab is hidden, or a hand is on the bars;
// with reduced motion, on Save-Data or a 2g/3g link the frames turn only on a
// click. Frames marked `wide` are left out on tall (phone) screens.

const FADE_MS = 1800;

const subscribeMedia = (query: string) => (notify: () => void) => {
  const list = window.matchMedia(query);
  list.addEventListener("change", notify);
  return () => list.removeEventListener("change", notify);
};
const TALL = "(max-aspect-ratio: 6 / 5)";
const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeTall = subscribeMedia(TALL);
const subscribeReduce = subscribeMedia(REDUCE);
const useMedia = (subscribe: (notify: () => void) => () => void, query: string) =>
  useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);

type NetworkInformation = { saveData?: boolean; effectiveType?: string };
const leanLink = () => {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(connection?.saveData || /(^|-)(2g|3g)$/.test(connection?.effectiveType ?? ""));
};
const noop = () => () => {};

export function WorldRotation({
  slug,
  name,
  rotation,
  active,
  settled,
}: {
  slug: string;
  name: string;
  rotation: HeroRotation;
  /** The hero is on screen. */
  active: boolean;
  /** The page has settled: later frames may load. */
  settled: boolean;
}) {
  const tall = useMedia(subscribeTall, TALL);
  const reduce = useMedia(subscribeReduce, REDUCE);
  const lean = useSyncExternalStore(noop, leanLink, () => false);
  const slides = rotation.slides.filter((slide) => !(tall && slide.wide));
  const { seconds } = rotation;
  const count = slides.length;

  const [currentKey, setCurrentKey] = useState(slides[0]?.base ?? "");
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState(true);
  const [held, setHeld] = useState(false);
  const [cycle, setCycle] = useState(0);
  // A frame picked by hand that has not loaded yet: it is mounted and turned to when it lands.
  const [wanted, setWanted] = useState<string | null>(null);

  const found = slides.findIndex((slide) => slide.base === currentKey);
  const index = found < 0 ? 0 : found;
  const current = slides[index]?.base ?? "";
  const next = slides[(index + 1) % count]?.base ?? "";
  const currentReady = Boolean(ready[current]);
  const auto = count > 1 && !reduce && !lean;

  // The latest state for timer and load callbacks.
  const live = useRef({ current, next, ready, wanted, due: false });
  useEffect(() => {
    live.current = { ...live.current, current, next, ready, wanted };
  });

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const go = (to: string) => {
    const from = live.current.current;
    if (to === from) return;
    live.current.due = false;
    setWanted(null);
    setLeavingKey(from);
    setCurrentKey(to);
    setCycle((value) => value + 1);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // Hold the current frame; then turn, or turn the moment the next frame lands.
  const running = auto && active && visible && !held && currentReady;
  useEffect(() => {
    live.current.due = false;
    if (!running) return;
    const timer = window.setTimeout(() => {
      const now = live.current;
      if (now.wanted !== null) return;
      if (now.ready[now.next]) goRef.current(now.next);
      else now.due = true;
    }, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [running, current, seconds, cycle]);

  useEffect(() => {
    if (leavingKey === null) return;
    const timer = window.setTimeout(() => setLeavingKey(null), FADE_MS + 100);
    return () => window.clearTimeout(timer);
  }, [leavingKey]);

  const markReady = (key: string) => {
    setReady((value) => (value[key] ? value : { ...value, [key]: true }));
    const now = live.current;
    if (now.wanted === key) go(key);
    else if (now.due && now.next === key) go(key);
  };

  const mounted = new Set<string>([current]);
  if (leavingKey !== null) mounted.add(leavingKey);
  if (auto && settled && currentReady) mounted.add(next);
  if (wanted !== null) mounted.add(wanted);

  return (
    <>
      <h1 className="wp-sr">{name}</h1>
      {rotation.slides.map((slide, i) =>
        mounted.has(slide.base) ? (
          <div
            key={slide.base}
            className="wp-slide"
            aria-hidden
            data-on={(slide.base === current && ready[slide.base]) || undefined}
            data-push={slide.base === current || slide.base === leavingKey || undefined}
            data-first={(i === 0 && cycle === 0) || undefined}
          >
            <WorldLayers
              slug={slug}
              name={name}
              hero={slide}
              active={active && (slide.base === current || slide.base === leavingKey)}
              draw={i === 0 && cycle === 0}
              heading={false}
              onReady={() => markReady(slide.base)}
            />
          </div>
        ) : null,
      )}
      {count > 1 && (
        <div
          className="wp-turns"
          role="group"
          aria-label="Opening frames"
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          {slides.map((slide, i) => (
            <button
              key={slide.base}
              type="button"
              className="wp-turn"
              aria-label={slide.label ?? `Frame ${i + 1}`}
              aria-current={slide.base === current || undefined}
              onClick={() => (ready[slide.base] ? go(slide.base) : setWanted(slide.base))}
              style={{ ["--wp-turn-s" as string]: `${seconds}s` }}
            >
              <i
                key={slide.base === current ? `on-${cycle}` : "off"}
                data-run={(slide.base === current && running) || undefined}
              />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
