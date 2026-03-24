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

function SkeletonLine({ width, height = 16, delay = 0 }: { width: string; height?: number; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay }}
      className="relative overflow-hidden rounded-md"
      style={{ width, height, background: "#ffffff08" }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(90deg, transparent, ${EMBER[4]}15, ${EMBER[8]}10, transparent)`,
          backgroundSize: "200% 100%",
          animation: "ember-shimmer 2s ease-in-out infinite",
          animationDelay: `${delay}s`,
        }}
      />
    </motion.div>
  );
}

function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-xl border p-5"
      style={{ borderColor: "#ffffff08", background: "#ffffff04" }}
    >
      <div className="flex gap-4">
        {/* Avatar */}
        <div
          className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full"
          style={{ background: "#ffffff08" }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(90deg, transparent, ${EMBER[2]}15, transparent)`,
              backgroundSize: "200% 100%",
              animation: "ember-shimmer 2s ease-in-out infinite",
              animationDelay: `${delay}s`,
            }}
          />
        </div>
        <div className="flex-1 space-y-2.5">
          <SkeletonLine width="60%" height={14} delay={delay} />
          <SkeletonLine width="40%" height={10} delay={delay + 0.1} />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <SkeletonLine width="100%" height={12} delay={delay + 0.2} />
        <SkeletonLine width="90%" height={12} delay={delay + 0.25} />
        <SkeletonLine width="70%" height={12} delay={delay + 0.3} />
      </div>
      {/* Image placeholder */}
      <div
        className="relative mt-4 overflow-hidden rounded-lg"
        style={{ height: 140, background: "#ffffff06" }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(120deg, transparent 30%, ${EMBER[0]}08, ${EMBER[4]}10, ${EMBER[8]}08, transparent 70%)`,
            backgroundSize: "200% 100%",
            animation: "ember-shimmer 2.5s ease-in-out infinite",
            animationDelay: `${delay + 0.15}s`,
          }}
        />
      </div>
      <div className="mt-4 flex gap-3">
        <SkeletonLine width="80px" height={28} delay={delay + 0.35} />
        <SkeletonLine width="80px" height={28} delay={delay + 0.4} />
      </div>
    </motion.div>
  );
}

function SkeletonList({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="space-y-3"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border p-3"
          style={{ borderColor: "#ffffff06", background: "#ffffff03" }}
        >
          <div
            className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded"
            style={{ background: "#ffffff08" }}
          >
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(90deg, transparent, ${EMBER[i * 2]}12, transparent)`,
                backgroundSize: "200% 100%",
                animation: "ember-shimmer 2s ease-in-out infinite",
                animationDelay: `${(delay ?? 0) + i * 0.1}s`,
              }}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <SkeletonLine width={`${70 - i * 8}%`} height={12} delay={(delay ?? 0) + i * 0.1} />
            <SkeletonLine width={`${50 - i * 5}%`} height={9} delay={(delay ?? 0) + i * 0.12} />
          </div>
          <SkeletonLine width="48px" height={20} delay={(delay ?? 0) + i * 0.15} />
        </div>
      ))}
    </motion.div>
  );
}

export default function EmberLoadingSkeleton() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setLoading((l) => !l), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <style>{`
        @keyframes ember-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      <div className="mb-12 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /6
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Ember Loading Skeleton
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Warm shimmer skeletons instead of cold gray. Auto-toggles every 5s.
        </p>
        <button
          onClick={() => setLoading((l) => !l)}
          className="mt-3 rounded-full border px-4 py-1.5 text-xs font-mono transition-colors"
          style={{
            borderColor: EMBER[4] + "40",
            color: EMBER[4],
            background: EMBER[4] + "10",
          }}
        >
          {loading ? "Show loaded" : "Show skeleton"}
        </button>
      </div>

      <div className="grid w-full max-w-4xl grid-cols-2 gap-6">
        {/* Card skeletons */}
        <div className="space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e040" }}>
            Card Skeletons
          </h3>
          <SkeletonCard delay={0} />
          <SkeletonCard delay={0.3} />
        </div>

        {/* List skeleton */}
        <div className="space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e040" }}>
            List Skeleton
          </h3>
          <SkeletonList delay={0.1} />

          {/* Paragraph skeleton */}
          <div className="mt-6">
            <h3
              className="mb-3 text-xs font-mono uppercase tracking-wider"
              style={{ color: "#f0e8e040" }}
            >
              Text Skeleton
            </h3>
            <div
              className="space-y-2 rounded-xl border p-5"
              style={{ borderColor: "#ffffff08", background: "#ffffff04" }}
            >
              <SkeletonLine width="45%" height={20} delay={0.2} />
              <div className="mt-3 space-y-2">
                {[100, 95, 88, 92, 60].map((w, i) => (
                  <SkeletonLine key={i} width={`${w}%`} height={11} delay={0.25 + i * 0.05} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <nav className="mt-16 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/5" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/7" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
