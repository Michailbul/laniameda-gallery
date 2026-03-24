"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, ArrowRight } from "lucide-react";
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

const gradientCSS = `linear-gradient(90deg, ${EMBER.join(", ")}, ${EMBER[0]})`;

export default function ShimmerSweepSearchBar() {
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <style>{`
        @keyframes shimmer-sweep {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .shimmer-border {
          background: ${gradientCSS};
          background-size: 200% 100%;
          animation: shimmer-sweep 3s linear infinite;
        }
        .shimmer-border-slow {
          background: ${gradientCSS};
          background-size: 200% 100%;
          animation: shimmer-sweep 6s linear infinite;
        }
      `}</style>

      <div className="mb-16 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /3
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Shimmer Sweep Search Bar
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          A search input with an animated ember gradient border.
        </p>
      </div>

      <div className="w-full max-w-xl space-y-8">
        {/* Main shimmer search */}
        <div className="relative">
          <div
            className={`rounded-2xl p-[2px] ${focused ? "shimmer-border" : "shimmer-border-slow"}`}
            style={{ opacity: focused ? 1 : 0.4 }}
          >
            <div
              className="flex items-center gap-3 rounded-[14px] px-5 py-4"
              style={{ background: "#0a0a0a" }}
            >
              <Search size={20} style={{ color: focused ? EMBER[4] : "#f0e8e040" }} />
              <input
                type="text"
                placeholder="Search the ember..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="flex-1 bg-transparent text-base outline-none placeholder:text-[#f0e8e030]"
                style={{ color: "#f0e8e0" }}
              />
              <motion.div
                animate={{ opacity: query ? 1 : 0, scale: query ? 1 : 0.8 }}
                className="cursor-pointer"
              >
                <ArrowRight size={20} style={{ color: EMBER[4] }} />
              </motion.div>
            </div>
          </div>
        </div>

        {/* Compact variant */}
        <div className="relative">
          <div className="shimmer-border rounded-xl p-[1px]" style={{ opacity: 0.6 }}>
            <div
              className="flex items-center gap-2 rounded-[11px] px-4 py-3"
              style={{ background: "#0a0a0a" }}
            >
              <Search size={16} style={{ color: "#f0e8e040" }} />
              <input
                type="text"
                placeholder="Compact search variant..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#f0e8e030]"
                style={{ color: "#f0e8e0" }}
              />
            </div>
          </div>
        </div>

        {/* Pill variant */}
        <div className="flex justify-center">
          <div className="shimmer-border rounded-full p-[2px]" style={{ opacity: 0.7 }}>
            <div
              className="flex items-center gap-2 rounded-full px-6 py-3"
              style={{ background: "#0a0a0a" }}
            >
              <Search size={16} style={{ color: EMBER[6] }} />
              <input
                type="text"
                placeholder="Pill search..."
                className="w-48 bg-transparent text-sm outline-none placeholder:text-[#f0e8e030]"
                style={{ color: "#f0e8e0" }}
              />
            </div>
          </div>
        </div>
      </div>

      <nav className="mt-20 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/2" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/4" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
