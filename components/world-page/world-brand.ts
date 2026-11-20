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
  /** phone: the mark's top on tall screens, in svh (default near the top). */
  title: { x: number; t: number; w: number; z: number; phone?: number };
  petals?: boolean;
  /** Warm sparks rising instead of petals. */
  embers?: boolean;
  /** The link preview (og:image), 1200×630, a path under public/. */
  og: string;
  /** Plain words for the frame (the rotation's buttons). */
  label?: string;
  /** A portrait crop for tall screens: p0-m … pN-m, w×h at native size. */
  phone?: { w: number; h: number };
  /** Wide screens only (no phone crop keeps the subject clear of the mark). */
  wide?: boolean;
  /** Scales the pointer drift and scroll push (1 = full). */
  drift?: number;
};

/** Several layered openings that take turns, each held for `seconds`. */
export type HeroRotation = { slides: LayeredHero[]; seconds: number };

export type WorldBrand = {
  /** Drawn wordmark: `stack` opens the page, `line` sits in the bar. */
  wordmark?: { stack: Mark; line: Mark };
  /** One line under the mark; `accent` is set in the world's accent colour. */
  tagline?: { before: string; accent: string; after?: string };
  /** Replaces the first hero insert as the opening (the insert's frame stays off the wall). */
  layeredHero?: LayeredHero;
  /** The opening takes turns through these frames (the first is also `layeredHero`). */
  heroRotation?: HeroRotation;
};

const PLANES = [0, 0.2, 0.4, 0.6, 0.8, 1];
const OG = "/world-hero/dear-annete/og.jpg";
// Michael's picked 3D frames (board rounds v15–v18, kept 18–20 Nov 2026), cut into depth planes.
// Each pixel sits in one plane over an inpainted backplate, so a gentle drift shows no doubled edges.
const daSlide = (
  dir: string,
  label: string,
  title: { x: number; t: number; w: number; phone?: number; z?: number },
  fx: "petals" | "embers",
  phone: boolean,
): LayeredHero => ({
  base: `/world-hero/dear-annete/${dir}`,
  w: 2400,
  h: 1333,
  planes: PLANES,
  title: { z: 4, ...title },
  petals: fx === "petals",
  embers: fx === "embers",
  og: OG,
  label,
  drift: 0.55,
  ...(phone ? { phone: { w: 900, h: 1600 } } : { wide: true }),
});
const DA_SLIDES: LayeredHero[] = [
  daSlide("slope", "Up the slope toward the city", { x: 62, t: 12, w: 20 }, "embers", true),
  daSlide("lily-hand", "The knight's fingers above the lily", { x: 50, t: 11, w: 20 }, "petals", true),
  daSlide("window", "Through the window", { x: 50, t: 9, w: 18 }, "embers", true),
  daSlide("lily-between", "The lily between them", { x: 50, t: 11, w: 20 }, "petals", false),
  daSlide("towers", "Her hair, the gold-crowned towers", { x: 50, t: 11, w: 20 }, "embers", true),
  daSlide("visor", "The crimson visor", { x: 73, t: 12, w: 18 }, "embers", false),
  daSlide("hands", "Both hands, the morning light", { x: 72, t: 15, w: 16 }, "embers", false),
  daSlide("ruins", "Eyes closed, the cathedral ruins", { x: 27, t: 12, w: 18 }, "petals", true),
  // The fallen giant in the crimson field (v7 hero F6, kept 6 Nov 2026).
  {
    base: "/world-hero/dear-annete",
    w: 2400,
    h: 1023,
    planes: PLANES,
    title: { x: 50, t: 8, w: 22, z: 4 },
    petals: true,
    og: OG,
    label: "The fallen giant in the crimson field",
  },
];

const BRANDS: Record<string, WorldBrand> = {
  "dear-annete": {
    wordmark: DEAR_ANNETE_WORDMARK,
    tagline: { before: "Monsters want to be ", accent: "loved" },
    layeredHero: DA_SLIDES[0],
    heroRotation: { slides: DA_SLIDES, seconds: 9 },
  },
};

export const worldBrand = (slug: string): WorldBrand => BRANDS[slug] ?? {};
