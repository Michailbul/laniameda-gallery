import type { Metadata } from "next";
import { WorldEntry } from "@/components/gallery/world-entry";

export const metadata: Metadata = { title: "World — Laniameda", robots: { index: false, follow: false } };

// The signed-in owner's /w/<slug>: proxy.ts rewrites a visit with a valid
// session here, so the public pitch page (../page.tsx) never imports the
// vault. The browser keeps the /w/<slug> address; the vault reads it from
// window.location.
export default async function OwnerWorldPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <WorldEntry slug={slug} />;
}
