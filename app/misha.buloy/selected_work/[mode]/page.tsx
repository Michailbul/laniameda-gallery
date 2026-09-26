import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preconnect, preload } from "react-dom";
import "@/app/tokens.css";
import { PUBLIC_MODES, isPublicMode } from "@/lib/public-modes";
import { SelectedWorkClient } from "../selected-work-client";
import { loadFirstScreen } from "../first-screen";

// Static HTML, rebuilt at most every five minutes. The Convex read below
// asks for no-store, which would otherwise turn every visit into a function
// call; the grid itself still subscribes live on the client.
export const dynamic = "force-static";
export const revalidate = 300;

// One page per view. The segment is validated against PUBLIC_MODES, so an
// invented URL 404s instead of quietly rendering Featured.
export function generateStaticParams() {
  return PUBLIC_MODES.map((entry) => ({ mode: entry.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mode: string }>;
}): Promise<Metadata> {
  const { mode } = await params;
  const entry = PUBLIC_MODES.find((candidate) => candidate.id === mode);
  if (!entry) return {};

  return {
    title: `${entry.label} — Misha Buloichyk`,
    // A view without a blurb falls back to its title rather than an empty tag.
    description: entry.blurb || entry.title,
  };
}

export default async function SelectedWorkModePage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  if (!isPublicMode(mode)) notFound();

  // The grid renders this at hydration, and its first thumbnails download
  // with the HTML, so they are in the browser cache by the time it mounts.
  const firstScreen = await loadFirstScreen(mode);
  const assetOrigins = new Set(
    firstScreen.thumbs.map((url) => new URL(url).origin),
  );
  for (const origin of assetOrigins) preconnect(origin);
  for (const url of firstScreen.thumbs) {
    preload(url, { as: "image", fetchPriority: "high" });
  }

  return (
    <div style={{ background: "var(--lm-paper)" }}>
      <SelectedWorkClient mode={mode} firstScreen={firstScreen.data} />
    </div>
  );
}
