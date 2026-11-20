"use client";

import { useEffect, useRef, useState } from "react";
import type { LayeredHero } from "./world-brand";
import { WorldWordmark } from "./world-wordmark";

// The opening hero as a stack of depth planes cut from one still: the planes
// drift against each other on the pointer (tilt on phones) and push apart as
// the hero scrolls away. The world's mark sits inside the stack, so the
// nearest plane passes in front of it. Only whole planes move.
//
// The stack is fitted by CSS (cover, centred), so the first paint is right
// before any script runs; the script only adds the drift.

const srcSetFor = (base: string, index: number) =>
  `${base}/p${index}-1200.webp 1200w, ${base}/p${index}.webp 2400w, ${base}/p${index}-4k.webp 4096w`;

export function WorldLayers({
  slug,
  name,
  hero,
  active,
  draw = true,
  heading = true,
  onReady,
}: {
  slug: string;
  name: string;
  hero: LayeredHero;
  /** On screen: the drift and the petals run. */
  active: boolean;
  /** Trace the mark (the first frame of the page only). */
  draw?: boolean;
  /** The mark is the page's h1 (off when a rotation holds its own heading). */
  heading?: boolean;
  /** Called once every plane is in. */
  onReady?: () => void;
}) {
  const stack = useRef<HTMLDivElement>(null);
  const petals = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const activeRef = useRef(active);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    if (ready) onReadyRef.current?.();
  }, [ready]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Show the stack once every plane is in, so it never paints half-built.
  useEffect(() => {
    const node = stack.current;
    if (!node) return;
    const images = [...node.querySelectorAll("img")];
    let left = images.filter((image) => !image.complete).length;
    if (!left) {
      const frame = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(frame);
    }
    const done = () => {
      left -= 1;
      if (left <= 0) setReady(true);
    };
    images.forEach((image) => {
      if (!image.complete) {
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
      }
    });
    const timer = window.setTimeout(() => setReady(true), 3500);
    return () => window.clearTimeout(timer);
  }, []);

  // Drift: pointer or tilt, a slow idle sway, and a push on scroll.
  useEffect(() => {
    const node = stack.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const drift = hero.drift ?? 1;
    const layers = [...node.querySelectorAll<HTMLElement>("[data-depth]")];
    const section = node.closest(".wp-hero");
    let tx = 0;
    let ty = 0;
    let px = 0;
    let py = 0;
    let frame = 0;
    const t0 = performance.now();
    const onPointer = (event: PointerEvent) => {
      tx = (event.clientX / window.innerWidth) * 2 - 1;
      ty = (event.clientY / window.innerHeight) * 2 - 1;
    };
    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null) return;
      tx = Math.max(-1, Math.min(1, event.gamma / 25));
      ty = Math.max(-1, Math.min(1, (event.beta - 45) / 25));
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!activeRef.current) return;
      px += (tx - px) * 0.05;
      py += (ty - py) * 0.05;
      const scale = node.clientWidth / hero.w;
      const rect = section?.getBoundingClientRect();
      const span = rect ? Math.max(1, rect.height - window.innerHeight) : 1;
      const p = rect ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
      const t = (now - t0) / 1000;
      const ix = Math.sin(t * 0.23) * 0.35;
      const iy = Math.cos(t * 0.17) * 0.25;
      for (const layer of layers) {
        const d = Number(layer.dataset.depth) * drift;
        const mx = -(px + ix) * d * 70 * scale;
        const my = (-(py + iy) * d * 34 - p * d * 240) * scale;
        layer.style.transform = `translate3d(${mx.toFixed(2)}px,${my.toFixed(2)}px,0) scale(${(1 + p * d * d * 0.35).toFixed(4)})`;
      }
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("deviceorientation", onTilt);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, [hero.w, hero.drift]);

  // Petals drifting across the field, over the stack.
  useEffect(() => {
    const canvas = petals.current;
    const mode = hero.petals ? "petals" : hero.embers ? "embers" : null;
    if (!canvas || !mode) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const small = window.matchMedia("(max-width: 760px)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0;
    let H = 0;
    const size = () => {
      W = canvas.width = canvas.clientWidth * dpr;
      H = canvas.height = canvas.clientHeight * dpr;
    };
    size();
    window.addEventListener("resize", size);
    type Petal = { x: number; y: number; z: number; vx: number; vy: number; r: number; a: number; va: number; t: number };
    const spawn = (init: boolean): Petal => {
      const z = Math.random();
      if (mode === "embers") {
        return {
          x: Math.random() * W,
          y: init ? Math.random() * H : H + 20,
          z,
          vx: 0.15 + z * 0.35,
          vy: -(0.25 + z * 0.7),
          r: (0.8 + z * 2.2) * dpr,
          a: 0,
          va: 0,
          t: Math.random() * 6,
        };
      }
      return {
        x: init ? Math.random() * W : -30,
        y: Math.random() * H * 0.9,
        z,
        vx: 0.5 + z * 1.3,
        vy: 0.15 + z * 0.4,
        r: (3 + z * 7) * dpr,
        a: Math.random() * 6,
        va: (Math.random() - 0.5) * 0.04,
        t: Math.random() * 6,
      };
    };
    const parts = Array.from({ length: (small ? 26 : 56) * (mode === "embers" ? 1.6 : 1) }, () => spawn(true));
    let last = 0;
    let frame = 0;
    const loop = (ts: number) => {
      frame = requestAnimationFrame(loop);
      if (!activeRef.current) {
        last = 0;
        return;
      }
      const dt = Math.min(50, ts - (last || ts)) / 16.7;
      last = ts;
      ctx.clearRect(0, 0, W, H);
      for (const q of parts) {
        q.t += 0.02 * dt;
        q.x += (q.vx + Math.sin(q.t) * 0.4) * dt * dpr;
        q.y += (q.vy + Math.cos(q.t * 0.7) * 0.3) * dt * dpr;
        q.a += q.va * dt;
        if (mode === "embers") {
          const flicker = 0.55 + 0.45 * Math.sin(q.t * 5);
          ctx.fillStyle = `rgba(255,${(150 + q.z * 70) | 0},${(60 + q.z * 40) | 0},${(0.35 + q.z * 0.5) * flicker})`;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
          ctx.fill();
          if (q.y < -20 || q.x > W + 20) Object.assign(q, spawn(false));
          continue;
        }
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.a);
        ctx.scale(1, 0.45 + 0.35 * Math.sin(q.t * 2));
        ctx.fillStyle = `rgba(${(150 + q.z * 60) | 0},${(14 + q.z * 10) | 0},${(28 + q.z * 12) | 0},${0.5 + q.z * 0.4})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, q.r, q.r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (q.x > W + 40 || q.y > H + 40) Object.assign(q, spawn(false));
      }
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", size);
    };
  }, [hero.petals, hero.embers]);

  const { title } = hero;
  return (
    <>
      <div
        ref={stack}
        className="wp-layers"
        data-ready={ready || undefined}
        data-phone={hero.phone ? true : undefined}
        style={{
          ["--wp-layers-ratio" as string]: `${hero.w} / ${hero.h}`,
          ["--wp-layers-r" as string]: hero.w / hero.h,
          ...(hero.phone
            ? {
                ["--wp-layers-ratio-m" as string]: `${hero.phone.w} / ${hero.phone.h}`,
                ["--wp-layers-r-m" as string]: hero.phone.w / hero.phone.h,
              }
            : {}),
        }}
      >
        {hero.planes.map((depth, index) => (
          <LayerPlane
            key={index}
            index={index}
            depth={depth}
            base={hero.base}
            phone={Boolean(hero.phone)}
            title={
              index === title.z ? (
                <div className="wp-layers-title-plane" data-depth={(depth + 0.08).toFixed(2)}>
                  <WorldWordmark
                    slug={slug}
                    name={name}
                    as={heading ? "h1" : "div"}
                    draw={draw}
                    className="wp-layers-title"
                    style={{
                      left: `${title.x}%`,
                      top: `${title.t}%`,
                      width: `${title.w}%`,
                      ...(title.phone != null ? { ["--wp-title-phone" as string]: `${title.phone}svh` } : {}),
                    }}
                  />
                </div>
              ) : null
            }
          />
        ))}
      </div>
      {(hero.petals || hero.embers) && <canvas ref={petals} className="wp-petals" aria-hidden />}
    </>
  );
}

function LayerPlane({
  index,
  depth,
  base,
  phone,
  title,
}: {
  index: number;
  depth: number;
  base: string;
  /** A portrait crop exists for tall screens. */
  phone: boolean;
  title: React.ReactNode;
}) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- planes are static, sized by srcset
    <img
        className="wp-layer"
        data-depth={depth}
        src={`${base}/p${index}.webp`}
        srcSet={srcSetFor(base, index)}
        sizes="(max-width: 760px) 200vw, 112vw"
        alt=""
        draggable={false}
        decoding="async"
        fetchPriority={index < 2 ? "high" : "auto"}
      />
  );
  return (
    <>
      {phone ? (
        <picture>
          <source media="(max-aspect-ratio: 6 / 5)" srcSet={`${base}/p${index}-m.webp`} />
          {img}
        </picture>
      ) : (
        img
      )}
      {title}
    </>
  );
}
