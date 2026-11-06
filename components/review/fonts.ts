import { Inter, JetBrains_Mono } from "next/font/google";

// The review page's own type: Inter (titles 800 uppercase, body) and
// JetBrains Mono (codes, dates, counts). Variable fonts, one file each.
export const reviewSans = Inter({ subsets: ["latin"], variable: "--rv-sans", display: "swap" });
// Mono sets small labels only: not preloaded (never competes with the first
// frame) and "optional" (no late swap, so the top bar never shifts; cached
// for the next visit).
export const reviewMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--rv-mono",
  display: "optional",
  preload: false,
  // Until it is cached, a real system monospace stands in (not the default Arial-based fallback).
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const reviewFontClass = `${reviewSans.variable} ${reviewMono.variable}`;
