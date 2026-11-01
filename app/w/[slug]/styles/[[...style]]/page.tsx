import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";
import { WorldStylesPage } from "@/components/styles/world-styles-page";

export const metadata: Metadata = { title: "Styles · Laniameda", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// /w/<world>/styles[/<style>]: every style of the world's universe, its own
// wide page with no sidebar (components/styles/world-styles-page).
export default async function Page({ params }: { params: Promise<{ slug: string; style?: string[] }> }) {
  const { slug, style } = await params;
  return <WorldStylesPage world={decodeURIComponent(slug)} styleRef={style?.[0] ? decodeURIComponent(style[0]) : undefined} />;
}
