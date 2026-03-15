"use client";

import { useEffect, useRef } from "react";
import styles from "./landing.module.css";

function interpolatePath(progress: number): string {
  let v: number, qy: number, ey: number;
  if (progress <= 0.5) {
    const t = progress * 2;
    const eased = t * t;
    v = 100 - 50 * eased;
    qy = 100 - 100 * eased;
    ey = 100 - 50 * eased;
  } else {
    const t = (progress - 0.5) * 2;
    const eased = 1 - (1 - t) * (1 - t);
    v = 50 - 50 * eased;
    qy = 0;
    ey = 50 - 50 * eased;
  }
  return `M 0 100 V ${v} Q 50 ${qy} 100 ${ey} V 100 z`;
}

const TITLE = "laniameda";

export default function LandingPage() {
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

      // SVG morphs
      if (p1Ref.current) p1Ref.current.setAttribute("d", interpolatePath(m1));
      if (p2Ref.current) p2Ref.current.setAttribute("d", interpolatePath(m2));
      if (p3Ref.current) p3Ref.current.setAttribute("d", interpolatePath(m3));

      // Section 1: hero
      if (s1Ref.current) {
        const o = Math.max(0, 1 - m1 * 2.5);
        s1Ref.current.style.opacity = String(o);
        s1Ref.current.style.transform = `translateY(${m1 * -60}px) scale(${1 - m1 * 0.08})`;
      }
      if (cueRef.current) {
        cueRef.current.style.opacity = String(Math.max(0, 1 - scrollY / (dwell * 0.5)));
      }

      // Section 2
      if (s2Ref.current) {
        const o = fadeIn(m1, 0.6, 1) * Math.max(0, 1 - m2 * 2.5);
        s2Ref.current.style.opacity = String(o);
        s2Ref.current.style.transform = `translateY(${m2 * -60}px) scale(${1 - m2 * 0.08})`;
      }

      // Section 3
      if (s3Ref.current) {
        const o = fadeIn(m2, 0.6, 1) * Math.max(0, 1 - m3 * 2.5);
        s3Ref.current.style.opacity = String(o);
        s3Ref.current.style.transform = `translateY(${m3 * -60}px) scale(${1 - m3 * 0.08})`;
      }

      // Section 4
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

    // Instantly start at scroll position showing the gradient arc peek
    const H = window.innerHeight;
    window.scrollTo(0, H * 0.75);

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className={styles.main}>
      <div ref={wrapRef} className={styles.scrollWrap}>
        <div className={styles.viewport}>
          {/* Base dark bg — z:1 */}
          <div className={styles.heroBg}>
            <div className={styles.grain} />
            <div className={styles.glow} />
          </div>

          {/* Section 1 content — z:5 */}
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

          {/* SVG 1→2 — z:10 */}
          <svg className={styles.svg} style={{ zIndex: 10 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="g12" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0.2" stopColor="rgb(255,135,9)" />
                <stop offset="0.7" stopColor="rgb(247,189,248)" />
              </linearGradient>
            </defs>
            <path ref={p1Ref} fill="url(#g12)" stroke="url(#g12)" strokeWidth="2" vectorEffect="non-scaling-stroke" d="M 0 100 V 100 Q 50 100 100 100 V 100 z" />
          </svg>

          {/* Section 2 content — z:15 */}
          <div ref={s2Ref} className={styles.layer} style={{ zIndex: 15, opacity: 0 }}>
            <h2 className={`${styles.sectionTitle} ${styles.dark}`}>Section 2</h2>
          </div>

          {/* SVG 2→3 — z:20 */}
          <svg className={styles.svg} style={{ zIndex: 20 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="g23" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0.2" stopColor="rgb(129,140,248)" />
                <stop offset="0.7" stopColor="rgb(94,234,212)" />
              </linearGradient>
            </defs>
            <path ref={p2Ref} fill="url(#g23)" stroke="url(#g23)" strokeWidth="2" vectorEffect="non-scaling-stroke" d="M 0 100 V 100 Q 50 100 100 100 V 100 z" />
          </svg>

          {/* Section 3 content — z:25 */}
          <div ref={s3Ref} className={styles.layer} style={{ zIndex: 25, opacity: 0 }}>
            <h2 className={`${styles.sectionTitle} ${styles.dark}`}>Curated Visual Intelligence</h2>
            <p className={`${styles.sectionDesc} ${styles.darkSub}`}>
              Where AI-generated art meets curatorial precision.
              <br />A visual workspace for creators, designers, and visionaries.
            </p>
          </div>

          {/* SVG 3→4 — z:30 */}
          <svg className={styles.svg} style={{ zIndex: 30 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="g34" x1="0" y1="1" x2="1" y2="0" gradientUnits="objectBoundingBox">
                <stop offset="0.3" stopColor="#0e100f" />
                <stop offset="0.9" stopColor="#1a1d1b" />
              </linearGradient>
            </defs>
            <path ref={p3Ref} fill="url(#g34)" stroke="url(#g34)" strokeWidth="2" vectorEffect="non-scaling-stroke" d="M 0 100 V 100 Q 50 100 100 100 V 100 z" />
          </svg>

          {/* Section 4 content — z:35 */}
          <div ref={s4Ref} className={styles.layer} style={{ zIndex: 35, opacity: 0 }}>
            <h2 className={styles.finalTitle}>Section 4</h2>
          </div>
        </div>
      </div>
    </main>
  );
}
