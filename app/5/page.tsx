"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
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

const gradientCSS = `linear-gradient(135deg, ${EMBER.join(", ")})`;

const CARDS = [
  { id: 1, title: "Alpine Summit", subtitle: "Mountain range at golden hour", hue: 0 },
  { id: 2, title: "Desert Bloom", subtitle: "Cacti under scorching sun", hue: 30 },
  { id: 3, title: "Ocean Fire", subtitle: "Sunset reflected on waves", hue: 15 },
  { id: 4, title: "Volcanic Glass", subtitle: "Obsidian formations at dawn", hue: 45 },
  { id: 5, title: "Amber Forest", subtitle: "Autumn canopy from above", hue: 35 },
  { id: 6, title: "Solar Flare", subtitle: "Corona during eclipse", hue: 10 },
  { id: 7, title: "Rust Belt", subtitle: "Industrial decay in warm light", hue: 25 },
  { id: 8, title: "Magma Flow", subtitle: "Active lava at twilight", hue: 5 },
  { id: 9, title: "Copper Mine", subtitle: "Terraced earth patterns", hue: 40 },
];

export default function SelectionHighlightCards() {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <style>{`
        @keyframes border-rotate {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      <div className="mb-12 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /5
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Selection Highlight Cards
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Click cards to select. Selected cards glow with ember gradients.
        </p>
        <AnimatePresence>
          {selected.size > 0 && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 text-xs font-mono"
              style={{ color: EMBER[6] }}
            >
              {selected.size} selected
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-3 gap-4">
        {CARDS.map((card) => {
          const isSelected = selected.has(card.id);
          return (
            <motion.div
              key={card.id}
              onClick={() => toggle(card.id)}
              className="cursor-pointer select-none"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <div
                className="rounded-xl p-[2px] transition-all duration-500"
                style={{
                  background: isSelected ? gradientCSS : "#ffffff10",
                  backgroundSize: "200% 200%",
                  animation: isSelected ? "border-rotate 4s ease infinite" : undefined,
                }}
              >
                <div
                  className="relative flex flex-col justify-end overflow-hidden rounded-[10px] p-4"
                  style={{
                    background: `linear-gradient(135deg, hsl(${card.hue}, 30%, 8%), hsl(${card.hue + 20}, 20%, 12%))`,
                    height: 160,
                  }}
                >
                  {/* Selection check */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full"
                        style={{ background: EMBER[0] }}
                      >
                        <Check size={14} color="#000" strokeWidth={3} />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Ember glow overlay */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.15 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0"
                        style={{ background: gradientCSS }}
                      />
                    )}
                  </AnimatePresence>

                  <div className="relative z-10">
                    <h3
                      className="text-sm font-semibold"
                      style={{ color: isSelected ? EMBER[2] : "#f0e8e0" }}
                    >
                      {card.title}
                    </h3>
                    <p className="mt-0.5 text-xs" style={{ color: "#f0e8e060" }}>
                      {card.subtitle}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <nav className="mt-16 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/4" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/6" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
