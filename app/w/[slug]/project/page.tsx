import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";
import { ProjectPage } from "@/components/projects/project-page";

export const metadata: Metadata = { title: "Project · Laniameda", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// /w/<world>/project: the art director's project room (owner only): the
// world, its art-director shelves, the director review, what production sent
// and the inspiration for it (components/projects/project-page).
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProjectPage world={decodeURIComponent(slug)} />;
}
