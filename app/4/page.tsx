"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Mail, Lock, User } from "lucide-react";
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

function PulsingInput({
  icon: Icon,
  placeholder,
  type = "text",
}: {
  icon: typeof Search;
  placeholder: string;
  type?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative">
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.01); }
        }
        @keyframes gradient-rotate {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {/* Outer pulsing ring */}
      {focused && (
        <motion.div
          className="absolute -inset-1 rounded-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            background: gradientCSS,
            backgroundSize: "200% 200%",
            animation: "gradient-rotate 3s ease infinite, pulse-ring 2s ease-in-out infinite",
            filter: "blur(4px)",
          }}
        />
      )}

      {/* Border gradient */}
      <div
        className="relative rounded-xl p-[2px] transition-all duration-300"
        style={{
          background: focused ? gradientCSS : "#ffffff15",
          backgroundSize: "200% 200%",
          animation: focused ? "gradient-rotate 3s ease infinite" : undefined,
        }}
      >
        <div
          className="flex items-center gap-3 rounded-[10px] px-4 py-3.5"
          style={{ background: "#111110" }}
        >
          <Icon
            size={18}
            style={{
              color: focused ? EMBER[4] : "#f0e8e040",
              transition: "color 0.3s",
            }}
          />
          <input
            type={type}
            placeholder={placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#f0e8e030]"
            style={{ color: "#f0e8e0" }}
          />
        </div>
      </div>
    </div>
  );
}

export default function PulsingFocusRing() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <div className="mb-16 text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /4
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Pulsing Focus Ring
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Click into any field to see the breathing ember ring.
        </p>
      </div>

      <div className="w-full max-w-md space-y-5">
        <PulsingInput icon={User} placeholder="Username" />
        <PulsingInput icon={Mail} placeholder="Email address" type="email" />
        <PulsingInput icon={Lock} placeholder="Password" type="password" />
        <PulsingInput icon={Search} placeholder="Search anything..." />

        <motion.button
          className="w-full rounded-xl py-3.5 text-sm font-semibold text-black"
          style={{ background: gradientCSS }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Submit
        </motion.button>
      </div>

      <nav className="mt-20 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/3" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/5" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
