"use client";

/**
 * V3D — Floating Island
 * Diagonal sweep covers viewport, then the fill compresses inward
 * from all edges — shrinking into a floating rounded navbar with
 * margins on all sides. Like a pill-shaped island at the top.
 */

import { useEffect, useRef } from "react";
import styles from "../landing.module.css";

const NAV_H = 7;    // navbar height in viewBox units (≈7% of viewport)
const NAV_MARGIN = 3; // horizontal margin %

function diagonalSweep(progress: number): string {
  let leftY: number, rightY: number, curveY: number;
  if (progress <= 0.5) {
    const t = progress * 2;
    const eased = t * t;
    leftY = 100 - 70 * eased;
    rightY = 100 - 30 * eased;
    curveY = 100 - 55 * eased;
  } else {
    const t = (progress - 0.5) * 2;
    const eased = 1 - (1 - t) * (1 - t);
    leftY = 30 - 30 * eased;
    rightY = 70 - 70 * eased;
    curveY = 45 - 45 * eased;
  }
  return `M 0 100 V ${leftY} Q 50 ${curveY} 100 ${rightY} V 100 z`;
}

function navbarIsland(progress: number): string {
  if (progress <= 0.45) {
    const t = progress / 0.45;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const leftY = Math.max(0, 100 - 140 * eased);
    const rightY = Math.max(0, 100 - 110 * eased);
    const curveY = Math.max(0, 100 - 125 * eased);
    return `M 0 100 V ${leftY} Q 50 ${curveY} 100 ${rightY} V 100 z`;
  }

  if (progress <= 0.5) {
    return `M 0 100 V 0 Q 50 0 100 0 V 100 z`;
  }

  // Compress from all sides into a floating island
  const t = (progress - 0.5) / 0.5;
  const eased = 1 - (1 - t) * (1 - t) * (1 - t); // cubic ease-out

  const top = NAV_MARGIN * eased;
  const bottom = 100 - (100 - NAV_H - NAV_MARGIN) * eased;
  const left = NAV_MARGIN * eased;
  const right = 100 - NAV_MARGIN * eased;

  // Rounded corners via Q curves at each corner
  const r = 2 * eased;
  return [
    `M ${left} ${top + r}`,
    `Q ${left} ${top} ${left + r} ${top}`,
    `L ${right - r} ${top}`,
    `Q ${right} ${top} ${right} ${top + r}`,
    `L ${right} ${bottom - r}`,
    `Q ${right} ${bottom} ${right - r} ${bottom}`,
    `L ${left + r} ${bottom}`,
    `Q ${left} ${bottom} ${left} ${bottom - r}`,
    `Z`
  ].join(" ");
}

const TITLE = "laniameda";

export default function V3DPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const s1Ref = useRef<HTMLDivElement>(null);
  const s2Ref = useRef<HTMLDivElement>(null);
  const s3Ref = useRef<HTMLDivElement>(null);
  const s4Ref = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const p1Ref = useRef<SVGPathElement>(null);
  const p2Ref = useRef<SVGPathElement>(null);
  const p3Ref = useRef<SVGPathElement>(null);

  useEffect(() => {
    let ticking = false;

    const update = () => {
      if (!wrapRef.current) return;
      const H = window.innerHeight;
      const scrollY = Math.max(0, -wrapRef.current.getBoundingClientRect().top);

      const dwell = H * 0.5;
      const morphLen = H * 1.5;
      const t1s = dwell, t1e = t1s + morphLen;
      const t2s = t1e + dwell, t2e = t2s + morphLen;
      const t3s = t2e + dwell, t3e = t3s + morphLen;

      const prog = (s: number, e: number) =>
        Math.max(0, Math.min(1, (scrollY - s) / (e - s)));
      const fadeIn = (x: number, a: number, b: number) =>
        Math.max(0, Math.min(1, (x - a) / (b - a)));

      const m1 = prog(t1s, t1e);
      const m2 = prog(t2s, t2e);
      const m3 = prog(t3s, t3e);

      if (p1Ref.current) p1Ref.current.setAttribute("d", diagonalSweep(m1));
      if (p2Ref.current) p2Ref.current.setAttribute("d", navbarIsland(m2));
      if (p3Ref.current) p3Ref.current.setAttribute("d", diagonalSweep(m3));

      if (s1Ref.current) {
        const o = Math.max(0, 1 - m1 * 2.5);
        s1Ref.current.style.opacity = String(o);
        s1Ref.current.style.transform = `translateY(${m1 * -60}px) scale(${1 - m1 * 0.08})`;
      }
      if (cueRef.current) {
        cueRef.current.style.opacity = String(Math.max(0, 1 - scrollY / (dwell * 0.5)));
      }
      if (s2Ref.current) {
        const o = fadeIn(m1, 0.6, 1) * Math.max(0, 1 - m2 * 2);
        s2Ref.current.style.opacity = String(o);
        s2Ref.current.style.transform = `translateY(${m2 * -40}px) scale(${1 - m2 * 0.05})`;
      }
      if (s3Ref.current) {
        const o = fadeIn(m2, 0.6, 1) * Math.max(0, 1 - m3 * 2.5);
        s3Ref.current.style.opacity = String(o);
        s3Ref.current.style.transform = `translateY(${m3 * -60}px) scale(${1 - m3 * 0.08})`;
      }
      if (s4Ref.current) {
        s4Ref.current.style.opacity = String(fadeIn(m3, 0.6, 1));
      }

      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    const H = window.innerHeight;
    window.scrollTo(0, H * 0.75);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className={styles.main}>
      <div ref={wrapRef} className={styles.scrollWrap}>
        <div className={styles.viewport}>
          <div className={styles.heroBg}>
            <div className={styles.grain} />
            <div className={styles.glow} />
          </div>

          <div ref={s1Ref} className={styles.layer} style={{ zIndex: 5 }}>
            <h1 className={styles.title}>
              {TITLE.split("").map((ch, i) => (
                <span key={i} className={styles.letter} style={{ animationDelay: `${i * 0.07 + 0.4}s` }}>{ch}</span>
              ))}
            </h1>
            <div className={styles.rule} />
            <p className={styles.subtitle}>.gallery</p>
          </div>

          <div ref={cueRef} className={styles.scrollCue} style={{ zIndex: 5 }}>
            <span className={styles.scrollLabel}>scroll</span>
            <div className={styles.scrollBar} />
          </div>

          <svg className={styles.svg} style={{ zIndex: 10 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="g12" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0.2" stopColor="rgb(255,135,9)" />
                <stop offset="0.7" stopColor="rgb(247,189,248)" />
              </linearGradient>
            </defs>
            <path ref={p1Ref} fill="url(#g12)" stroke="url(#g12)" strokeWidth="2" vectorEffect="non-scaling-stroke" d="M 0 100 V 100 Q 50 100 100 100 V 100 z" />
          </svg>

          <div ref={s2Ref} className={styles.layer} style={{ zIndex: 15, opacity: 0 }}>
            <h2 className={`${styles.sectionTitle} ${styles.dark}`}>Section 2</h2>
          </div>

          <svg className={styles.svg} style={{ zIndex: 20 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="g23" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0.2" stopColor="rgb(129,140,248)" />
                <stop offset="0.7" stopColor="rgb(94,234,212)" />
              </linearGradient>
            </defs>
            <path ref={p2Ref} fill="url(#g23)" stroke="url(#g23)" strokeWidth="2" vectorEffect="non-scaling-stroke" d="M 0 100 V 100 Q 50 100 100 100 V 100 z" />
          </svg>

          <div ref={s3Ref} className={styles.layer} style={{ zIndex: 25, opacity: 0 }}>
            <h2 className={`${styles.sectionTitle} ${styles.dark}`}>Curated Visual Intelligence</h2>
            <p className={`${styles.sectionDesc} ${styles.darkSub}`}>
              Where AI-generated art meets curatorial precision.
              <br />A visual workspace for creators, designers, and visionaries.
            </p>
          </div>

          <svg className={styles.svg} style={{ zIndex: 30 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="g34" x1="0" y1="1" x2="1" y2="0" gradientUnits="objectBoundingBox">
                <stop offset="0.3" stopColor="#0e100f" />
                <stop offset="0.9" stopColor="#1a1d1b" />
              </linearGradient>
            </defs>
            <path ref={p3Ref} fill="url(#g34)" stroke="url(#g34)" strokeWidth="2" vectorEffect="non-scaling-stroke" d="M 0 100 V 100 Q 50 100 100 100 V 100 z" />
          </svg>

          <div ref={s4Ref} className={styles.layer} style={{ zIndex: 35, opacity: 0 }}>
            <h2 className={styles.finalTitle}>Section 4</h2>
          </div>
        </div>
      </div>
    </main>
  );
}
