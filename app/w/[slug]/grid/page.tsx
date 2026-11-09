import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";
import { RunGridPage } from "@/components/grid/run-grid";

export const metadata: Metadata = { title: "Run grid · Laniameda", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// /w/<world>/grid?run=<id>: a prompt run as a grid (rows = style presets,
// columns = prompts), owner only (components/grid/run-grid).
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ run?: string }> }) {
  const { slug } = await params;
  const { run } = await searchParams;
  return <RunGridPage world={decodeURIComponent(slug)} run={run} />;
}
