import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Collections · Laniameda", robots: { index: false, follow: false } };

// The Collections landing: every root, worlds first.
export default function Page() {
  return <GalleryRoot />;
}
