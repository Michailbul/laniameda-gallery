import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/app/tokens.css";
import { PUBLIC_MODES, isPublicMode } from "@/lib/public-modes";
import { SelectedWorkClient } from "../selected-work-client";

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

  return (
    <div style={{ background: "var(--lm-paper)" }}>
      <SelectedWorkClient mode={mode} />
    </div>
  );
}
