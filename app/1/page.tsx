"use client";

import { useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Home,
  Search,
  Settings,
  Bell,
  Mail,
  Camera,
  Music,
  Heart,
  Star,
  Zap,
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

const ICONS = [Home, Search, Settings, Bell, Mail, Camera, Music, Heart, Star, Zap];

function DockIcon({
  Icon,
  mouseX,
}: {
  Icon: (typeof ICONS)[number];
  mouseX: ReturnType<typeof useMotionValue<number>>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    if (!ref.current) return 200;
    const rect = ref.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    return Math.abs(val - center);
  });

  const scale = useTransform(distance, [0, 150, 300], [1.5, 1.1, 1]);
  const colorIndex = useTransform(distance, [0, 100, 200, 400], [0, 3, 6, 9]);

  return (
    <motion.div
      ref={ref}
      style={{ scale }}
      className="relative flex items-center justify-center"
    >
      <motion.div
        className="flex h-14 w-14 items-center justify-center rounded-2xl backdrop-blur-sm"
        style={{
          backgroundColor: useTransform(colorIndex, (i) => {
            const idx = Math.round(Math.min(9, Math.max(0, i)));
            return EMBER[idx] + "20";
          }),
          boxShadow: useTransform(colorIndex, (i) => {
            const idx = Math.round(Math.min(9, Math.max(0, i)));
            return `0 0 20px ${EMBER[idx]}40`;
          }),
        }}
      >
        <motion.div
          style={{
            color: useTransform(colorIndex, (i) => {
              const idx = Math.round(Math.min(9, Math.max(0, i)));
              return EMBER[idx];
            }),
          }}
        >
          <Icon size={24} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default function ProximityColorShiftDock() {
  const mouseX = useMotionValue(-1000);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
      onMouseMove={(e) => mouseX.set(e.clientX)}
      onMouseLeave={() => animate(mouseX, -1000, { duration: 0.3 })}
    >
      <div className="mb-16 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /1
        </p>
        <h1
          className="text-4xl font-bold"
          style={{
            fontFamily: "var(--font-display)",
            color: "#f0e8e0",
          }}
        >
          Proximity Color Shift Dock
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Move your cursor across the dock. Closest icon burns hottest.
        </p>
      </div>

      <div
        className="flex items-end gap-2 rounded-3xl border px-6 py-4"
        style={{
          borderColor: "#ffffff10",
          background: "#ffffff08",
          backdropFilter: "blur(20px)",
        }}
      >
        {ICONS.map((Icon, i) => (
          <DockIcon key={i} Icon={Icon} mouseX={mouseX} />
        ))}
      </div>

      <nav className="mt-20 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <span className="opacity-30">← Prev</span>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/2" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
