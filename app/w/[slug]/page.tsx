import type { Metadata } from "next";
import { WorldView } from "@/components/showcase/world-view";

export const metadata: Metadata = {
  title: "World — Laniameda",
  description: "A story world: scenes, characters, and locations.",
};

export default async function WorldPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <WorldView slug={slug} />;
}
