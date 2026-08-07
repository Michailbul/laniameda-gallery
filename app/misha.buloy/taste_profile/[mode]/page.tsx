import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/app/tokens.css";
import { PUBLIC_MODES, isPublicMode } from "@/lib/public-modes";
import { TasteProfileClient } from "../taste-profile-client";

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
    title: `${entry.label} — Misha Buloy · Laniameda`,
    description: entry.blurb,
  };
}

export default async function TasteProfileModePage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  if (!isPublicMode(mode)) notFound();

  return (
    <div style={{ background: "var(--lm-paper)" }}>
      <TasteProfileClient mode={mode} />
    </div>
  );
}
