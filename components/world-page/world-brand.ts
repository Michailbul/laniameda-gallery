import localFont from "next/font/local";
import { DEAR_ANNETE_WORDMARK } from "./wordmark-dear-annete";

// A world page's type and words, in one place. The display type is due a
// separate type treatment: swap the font here and the colour tokens at the
// top of world-pitch.css, and the page follows.

/** The page's UI face (bar, tagline, chrome): Cormorant Unicase 700, OFL. */
export const worldUiFont = localFont({
  src: "./fonts/cormorant-unicase-latin-700-normal.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  variable: "--wp-font-ui",
  fallback: ["Georgia", "serif"],
});

type Mark = { viewBox: string; d: string };

export type WorldBrand = {
  /** Drawn wordmark: `stack` opens the page, `line` sits in the bar. */
  wordmark?: { stack: Mark; line: Mark };
  /** One line under the mark; `accent` is set in the world's accent colour. */
  tagline?: { before: string; accent: string; after?: string };
};

const BRANDS: Record<string, WorldBrand> = {
  "dear-annete": {
    wordmark: DEAR_ANNETE_WORDMARK,
    tagline: { before: "Monsters want to be ", accent: "loved" },
  },
};

export const worldBrand = (slug: string): WorldBrand => BRANDS[slug] ?? {};
