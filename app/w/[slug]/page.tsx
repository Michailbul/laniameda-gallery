import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { WorldPitch } from "@/components/world-page/world-pitch";
import { parseWorldSection } from "@/components/world-page/types";
import { loadWorldFirstScreen } from "@/lib/server/world-first-screen";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// A failed read throws (and is not cached): the request answers 500, never a
// 404 a crawler could keep.
const loadFirstScreen = loadWorldFirstScreen;

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const first = await loadFirstScreen(slug, one(query.side), parseWorldSection(one(query.view)));
  if (!first) return { title: "World — Laniameda" };
  const name = first.world.name;
  const title = `${name} — a world by Misha Buloichyk`;
  const image = first.world.hero?.src ?? first.world.featured[0]?.src ?? first.page[0]?.src;
  return {
    title,
    description: `${name}. Characters, scenes and places of the world, in pictures.`,
    openGraph: {
      title,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: "summary_large_image", title, ...(image ? { images: [image] } : {}) },
  };
}

// The world as a pitch, rendered on the server with its reel poster and first
// frames. The signed-in owner never reaches this file without `?public=1`:
// proxy.ts sends their /w/<slug> to the vault (./owner-view). With
// `?public=1` the owner sees this page with the F / D keys.
export default async function WorldPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const section = parseWorldSection(one(query.view));
  const first = await loadFirstScreen(slug, one(query.side), section);
  if (!first) notFound();

  const hero = first.world.hero;
  if (hero) {
    preload(hero.src, {
      as: "image",
      fetchPriority: "high",
      ...(hero.srcSet ? { imageSrcSet: hero.srcSet, imageSizes: "100vw" } : {}),
    });
  }

  return (
    <WorldPitch
      slug={slug}
      initialSide={first.world.side}
      initialSection={section}
      initialWorld={first.world}
      initialPage={first.page}
    />
  );
}
