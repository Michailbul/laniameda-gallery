import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Cinematography · Laniameda", robots: { index: false, follow: false } };

// /cinematography: camera-move Skill packs.
export default function Page() {
  return <GalleryRoot />;
}
