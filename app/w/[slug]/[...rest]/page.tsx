import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "World · Laniameda", robots: { index: false, follow: false } };

// /w/<world>/<shelf> and /w/<world>/instructions|journal|tasks|moodboards|folders: one place inside a world. The world root itself is app/w/[slug]/page.tsx.
export default function Page() {
  return <GalleryRoot />;
}
