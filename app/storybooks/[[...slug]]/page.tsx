import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Storybooks · Laniameda", robots: { index: false, follow: false } };

// /storybooks and /storybooks/<id>: the dashboard opens the Storybooks view, with that book when given.
export default function Page() {
  return <GalleryRoot />;
}
