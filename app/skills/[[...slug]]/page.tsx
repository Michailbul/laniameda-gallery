import type { Metadata } from "next";
import { GalleryRoot } from "@/components/gallery/gallery-root";

export const metadata: Metadata = { title: "Skills · Laniameda", robots: { index: false, follow: false } };

// /skills and /skills/<id>: the Skills view, with that Skill's document when given. /skills/laniameda-gallery/* stays the agent skill bundle.
export default function Page() {
  return <GalleryRoot />;
}
