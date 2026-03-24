"use client";

import { useState } from "react";
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

function GradientText({
  children,
  className = "",
  as: Tag = "h1",
  animated = false,
  style = {},
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span";
  animated?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <Tag
      className={`bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage: gradientCSS,
        backgroundSize: animated ? "200% 100%" : "100% 100%",
        animation: animated ? "gradient-text-shift 4s ease infinite" : undefined,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

export default function GradientHeadingText() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <style>{`
        @keyframes gradient-text-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      <div className="mb-16 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /10
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Gradient Heading Text
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Typography showcase with ember gradient text. Hover headings for animation.
        </p>
      </div>

      <div className="w-full max-w-3xl space-y-12">
        {/* Display font */}
        <div className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e030" }}>
            Instrument Serif — Display
          </p>

          <motion.div
            onHoverStart={() => setHoveredIndex(0)}
            onHoverEnd={() => setHoveredIndex(null)}
            className="cursor-default"
          >
            <GradientText
              className="text-7xl font-normal"
              animated={hoveredIndex === 0}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Ember Palette
            </GradientText>
          </motion.div>

          <motion.div
            onHoverStart={() => setHoveredIndex(1)}
            onHoverEnd={() => setHoveredIndex(null)}
            className="cursor-default"
          >
            <GradientText
              as="h2"
              className="text-5xl font-normal italic"
              animated={hoveredIndex === 1}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Fire to Amber
            </GradientText>
          </motion.div>
        </div>

        {/* Sans serif */}
        <div className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e030" }}>
            Geist Sans — Headings
          </p>

          <motion.div
            onHoverStart={() => setHoveredIndex(2)}
            onHoverEnd={() => setHoveredIndex(null)}
            className="cursor-default"
          >
            <GradientText as="h2" className="text-6xl font-black tracking-tight" animated={hoveredIndex === 2}>
              BOLD & BURNING
            </GradientText>
          </motion.div>

          <motion.div
            onHoverStart={() => setHoveredIndex(3)}
            onHoverEnd={() => setHoveredIndex(null)}
            className="cursor-default"
          >
            <GradientText as="h3" className="text-4xl font-semibold" animated={hoveredIndex === 3}>
              Medium Weight Heading
            </GradientText>
          </motion.div>

          <motion.div
            onHoverStart={() => setHoveredIndex(4)}
            onHoverEnd={() => setHoveredIndex(null)}
            className="cursor-default"
          >
            <GradientText as="h4" className="text-2xl font-light tracking-wide" animated={hoveredIndex === 4}>
              Light Weight with Wide Tracking
            </GradientText>
          </motion.div>
        </div>

        {/* Mono */}
        <div className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e030" }}>
            Geist Mono — Code
          </p>

          <motion.div
            onHoverStart={() => setHoveredIndex(5)}
            onHoverEnd={() => setHoveredIndex(null)}
            className="cursor-default"
          >
            <GradientText
              as="h3"
              className="text-3xl font-bold"
              animated={hoveredIndex === 5}
              style={{ fontFamily: "var(--font-geist-mono)" }}
            >
              const ember = &quot;#ff4800&quot;
            </GradientText>
          </motion.div>
        </div>

        {/* Paragraph with gradient highlight */}
        <div className="space-y-4">
          <p className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e030" }}>
            Inline Gradient
          </p>
          <p className="text-lg leading-relaxed" style={{ color: "#f0e8e080" }}>
            The ember palette spans from{" "}
            <GradientText as="span" className="font-semibold" animated>
              volcanic orange (#ff4800)
            </GradientText>{" "}
            through warm tangerine to{" "}
            <GradientText as="span" className="font-semibold" animated>
              liquid amber (#ffb600)
            </GradientText>
            , capturing the full spectrum of fire.
          </p>
        </div>

        {/* Color swatches */}
        <div className="space-y-3">
          <p className="text-xs font-mono uppercase tracking-wider" style={{ color: "#f0e8e030" }}>
            Palette
          </p>
          <div className="flex gap-2">
            {EMBER.map((color, i) => (
              <motion.div
                key={i}
                className="flex h-12 flex-1 items-end justify-center rounded-lg pb-1.5"
                style={{ background: color }}
                whileHover={{ scale: 1.1, y: -4 }}
              >
                <span className="text-[9px] font-mono font-bold text-black/40">
                  {color.slice(1).toUpperCase()}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <nav className="mt-16 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/9" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/11" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
