import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Moodboards · Laniameda", robots: { index: false, follow: false } };

// /moodboards and /moodboards/<id>: the Moodboards tab, with that board when given.
export default function Page() {
  return <GalleryRoot />;
}
