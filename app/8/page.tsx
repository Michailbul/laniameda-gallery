"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

const EMBER = [
  "#ff4800",
  "#ff5400",
  "#ff6000",
  "#ff6d00",
  "#ff7900",
  "#ff8500",
  "#ff9100",
  "#ff9e00",
  "#ffaa00",
  "#ffb600",
] as const;

const gradientCSS = `linear-gradient(90deg, ${EMBER.join(", ")})`;

function useAnimatedProgress(target: number, duration: number = 2000) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

function ThinBar({ label, target }: { label: string; target: number }) {
  const value = useAnimatedProgress(target, 2500);
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs" style={{ color: "#f0e8e080" }}>
        <span>{label}</span>
        <span className="font-mono">{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "#ffffff08" }}>
        <motion.div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: gradientCSS,
          }}
        />
      </div>
    </div>
  );
}

function ChunkyBar({ label, target }: { label: string; target: number }) {
  const value = useAnimatedProgress(target, 3000);
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm font-medium" style={{ color: "#f0e8e0c0" }}>
        <span>{label}</span>
        <span className="font-mono" style={{ color: EMBER[4] }}>
          {Math.round(value)}%
        </span>
      </div>
      <div className="h-4 overflow-hidden rounded-lg" style={{ background: "#ffffff08" }}>
        <motion.div
          className="relative h-full rounded-lg"
          style={{
            width: `${value}%`,
            background: gradientCSS,
          }}
        >
          {/* Shimmer overlay */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
              backgroundSize: "200% 100%",
              animation: "progress-shimmer 2s linear infinite",
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}

function CircularProgress({ target, size = 120, strokeWidth = 8, label }: {
  target: number;
  size?: number;
  strokeWidth?: number;
  label: string;
}) {
  const value = useAnimatedProgress(target, 2000);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={`ember-grad-${label}`} x1="0%" y1="0%" x2="100%" y2="0%">
              {EMBER.map((c, i) => (
                <stop key={i} offset={`${(i / 9) * 100}%`} stopColor={c} />
              ))}
            </linearGradient>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#ffffff08"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`url(#ember-grad-${label})`}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.1s" }}
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center font-mono text-lg font-bold"
          style={{ color: EMBER[4] }}
        >
          {Math.round(value)}%
        </div>
      </div>
      <span className="text-xs" style={{ color: "#f0e8e060" }}>
        {label}
      </span>
    </div>
  );
}

export default function EmberProgressBars() {
  const [key, setKey] = useState(0);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <style>{`
        @keyframes progress-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      <div className="mb-12 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /8
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Ember Progress Bars
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Animated progress indicators with ember gradient fills.
        </p>
        <button
          onClick={() => setKey((k) => k + 1)}
          className="mt-3 rounded-full border px-4 py-1.5 text-xs font-mono transition-colors"
          style={{
            borderColor: EMBER[4] + "40",
            color: EMBER[4],
            background: EMBER[4] + "10",
          }}
        >
          Replay
        </button>
      </div>

      <div key={key} className="w-full max-w-2xl space-y-10">
        {/* Thin bars */}
        <div className="space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e040" }}>
            Thin Bars
          </h3>
          <ThinBar label="Uploading photos..." target={87} />
          <ThinBar label="Processing video..." target={64} />
          <ThinBar label="Generating thumbnails..." target={100} />
        </div>

        {/* Chunky bars */}
        <div className="space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e040" }}>
            Chunky Bars
          </h3>
          <ChunkyBar label="Storage Used" target={72} />
          <ChunkyBar label="Export Progress" target={45} />
        </div>

        {/* Circular progress */}
        <div>
          <h3
            className="mb-6 text-xs font-mono uppercase tracking-wider"
            style={{ color: "#f0e8e040" }}
          >
            Circular / Ring
          </h3>
          <div className="flex justify-center gap-10">
            <CircularProgress target={92} label="Upload" />
            <CircularProgress target={67} size={140} strokeWidth={10} label="Process" />
            <CircularProgress target={38} label="Sync" />
          </div>
        </div>
      </div>

      <nav className="mt-16 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/7" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/9" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
