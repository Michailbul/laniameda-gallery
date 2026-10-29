import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Motion · Laniameda", robots: { index: false, follow: false } };

// /motion: motion-design pieces by facet.
export default function Page() {
  return <GalleryRoot />;
}
