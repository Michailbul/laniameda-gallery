import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Bookmarks · Laniameda", robots: { index: false, follow: false } };

// /bookmarks: saved X posts.
export default function Page() {
  return <GalleryRoot />;
}
