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

/**
 * An opening hero made of depth planes cut from one still (back to front,
 * p0 … pN under `base`, each as -1200, plain 2400 and -4k WebP). The mark
 * sits after plane `title.z`; x / t / w are % of the still.
 */
export type LayeredHero = {
  base: string;
  w: number;
  h: number;
  planes: number[];
  title: { x: number; t: number; w: number; z: number };
  petals?: boolean;
  /** The link preview (og:image), 1200×630, a path under public/. */
  og: string;
};

export type WorldBrand = {
  /** Drawn wordmark: `stack` opens the page, `line` sits in the bar. */
  wordmark?: { stack: Mark; line: Mark };
  /** One line under the mark; `accent` is set in the world's accent colour. */
  tagline?: { before: string; accent: string; after?: string };
  /** Replaces the first hero insert as the opening (the insert's frame stays off the wall). */
  layeredHero?: LayeredHero;
};

const BRANDS: Record<string, WorldBrand> = {
  "dear-annete": {
    wordmark: DEAR_ANNETE_WORDMARK,
    tagline: { before: "Monsters want to be ", accent: "loved" },
    // The fallen giant in the crimson field (v7 hero F6, kept 6 Nov 2026).
    layeredHero: {
      base: "/world-hero/dear-annete",
      w: 2400,
      h: 1023,
      planes: [0, 0.2, 0.4, 0.6, 0.8, 1],
      title: { x: 50, t: 8, w: 22, z: 4 },
      petals: true,
      og: "/world-hero/dear-annete/og.jpg",
    },
  },
};

export const worldBrand = (slug: string): WorldBrand => BRANDS[slug] ?? {};
