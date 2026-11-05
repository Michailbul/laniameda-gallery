import type { Metadata } from "next";
import { WorldEntry } from "@/components/gallery/world-entry";

export const metadata: Metadata = {
  title: "World — Laniameda",
  description: "A story world: scenes, characters, and locations.",
};

// A visitor sees the public world page; the signed-in owner lands in the
// vault on that world (components/gallery/world-entry).
export default async function WorldPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <WorldEntry slug={slug} />;
}
