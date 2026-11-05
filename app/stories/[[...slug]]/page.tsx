import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Stories · Laniameda", robots: { index: false, follow: false } };

// /stories and /stories/<id>: the Stories view, with that text open when given.
export default function Page() {
  return <GalleryRoot />;
}
