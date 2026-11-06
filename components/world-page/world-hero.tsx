"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldTile } from "./types";
import type { WallOwnerState } from "./world-masonry";
import { InsertFrames } from "./world-insert";
import { WorldWordmark } from "./world-wordmark";
import { worldBrand } from "./world-brand";

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * The opening hero: the world's first hero insert full screen (or split, or
 * a triptych), the drawn wordmark and one line. It holds for a screen and a
 * half of scroll, pushes in slowly and goes to black before the wall.
 *
 * The poster is the first paint; a film is attached once the page has
 * settled (later on phones, never on Save-Data or 2g/3g), and a full-size
 * still swaps in on large screens.
 */
export function WorldHero({
  slug,
  name,
  opening,
  owner,
}: {
  slug: string;
  name: string;
  opening: { tiles: WorldTile[] } | null;
  owner?: WallOwnerState;
}) {
  const brand = worldBrand(slug);
  const [settled, setSettled] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [sound, setSound] = useState(false);
  const section = useRef<HTMLElement>(null);
  const hasFilm = opening?.tiles.some((tile) => tile.kind === "video") ?? false;
  const single = opening?.tiles.length === 1;

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 760px), (hover: none)").matches;
    let timer = 0;
    let idleHandle = 0;
    const w = window as IdleWindow;
    const start = () => setSettled(true);
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (typeof w.requestIdleCallback === "function") {
          idleHandle = w.requestIdleCallback(start, { timeout: 2000 });
        } else start();
      }, phone ? 3500 : 200);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      window.clearTimeout(timer);
      if (idleHandle) w.cancelIdleCallback?.(idleHandle);
    };
  }, []);

  // Films play only while the hero is on screen; the wall costs no decode.
  useEffect(() => {
    const node = section.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      className="wp-hero"
      id="top"
      ref={section}
      data-offscreen={!onScreen || undefined}
      data-film={(single && hasFilm) || undefined}
    >
      <div className="wp-hero-pin">
        <div className="wp-hero-media" aria-hidden>
          {opening && (
            <InsertFrames
              tiles={opening.tiles}
              near={settled}
              visible={onScreen}
              priority
              sound={sound}
              owner={owner}
            />
          )}
        </div>
        <div className="wp-hero-shade" />
        <div className="wp-hero-title">
          <WorldWordmark slug={slug} name={name} as="h1" className="wp-hero-mark" draw />
        </div>
        {brand.tagline && (
          <p className="wp-tagline">
            {brand.tagline.before}
            <b>{brand.tagline.accent}</b>
            {brand.tagline.after}
          </p>
        )}
        {hasFilm && single && (
          <button
            type="button"
            className="wp-sound"
            aria-pressed={sound}
            onClick={() => setSound((value) => !value)}
          >
            <span className="wp-bars" aria-hidden><i /><i /><i /><i /></span>
            {sound ? "Sound on" : "Sound off"}
          </button>
        )}
        <div className="wp-hero-black" aria-hidden />
      </div>
    </section>
  );
}
