"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame,
  Sun,
  Moon,
  Cloud,
  Droplets,
  Wind,
  Snowflake,
  Thermometer,
  Umbrella,
  Rainbow,
} from "lucide-react";
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

const ICONS = [
  { icon: Flame, label: "Flame" },
  { icon: Sun, label: "Sun" },
  { icon: Moon, label: "Moon" },
  { icon: Cloud, label: "Cloud" },
  { icon: Droplets, label: "Rain" },
  { icon: Wind, label: "Wind" },
  { icon: Snowflake, label: "Snow" },
  { icon: Thermometer, label: "Temp" },
  { icon: Umbrella, label: "Umbrella" },
  { icon: Rainbow, label: "Rainbow" },
];

function GlowIcon({
  icon: Icon,
  label,
  color,
}: {
  icon: (typeof ICONS)[number]["icon"];
  label: string;
  color: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      className="relative flex flex-col items-center gap-2"
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ y: -8 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
    >
      <div className="relative">
        <AnimatePresence>
          {hovered && (
            <motion.div
              className="absolute inset-0 rounded-2xl"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              style={{
                boxShadow: `0 0 30px ${color}80, 0 0 60px ${color}40, 0 0 90px ${color}20`,
              }}
            />
          )}
        </AnimatePresence>
        <motion.div
          className="relative flex h-16 w-16 items-center justify-center rounded-2xl border"
          animate={{
            borderColor: hovered ? color + "60" : "#ffffff15",
            backgroundColor: hovered ? color + "15" : "#ffffff08",
            boxShadow: hovered
              ? [
                  `0 0 20px ${color}30`,
                  `0 0 40px ${color}50`,
                  `0 0 20px ${color}30`,
                ]
              : `0 0 0px ${color}00`,
          }}
          transition={{
            boxShadow: {
              repeat: Infinity,
              duration: 2,
              ease: "easeInOut",
            },
            default: { duration: 0.3 },
          }}
        >
          <Icon size={26} style={{ color: hovered ? color : "#f0e8e060" }} />
        </motion.div>
      </div>
      <motion.span
        className="text-xs font-mono"
        animate={{ color: hovered ? color : "#f0e8e040" }}
      >
        {label}
      </motion.span>
    </motion.div>
  );
}

export default function ActiveGlowDock() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <div className="mb-16 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /2
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Active Glow Dock
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Hover each icon to ignite its ember glow.
        </p>
      </div>

      <div
        className="flex items-end gap-4 rounded-3xl border px-8 py-6"
        style={{
          borderColor: "#ffffff10",
          background: "#ffffff05",
          backdropFilter: "blur(20px)",
        }}
      >
        {ICONS.map((item, i) => (
          <GlowIcon key={i} icon={item.icon} label={item.label} color={EMBER[i]} />
        ))}
      </div>

      <nav className="mt-20 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/1" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/3" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
