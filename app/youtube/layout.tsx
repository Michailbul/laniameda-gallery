import type { Metadata } from "next";
import "@/app/tokens.css";
import "./youtube.css";

export const metadata: Metadata = {
  title: "YouTube — Laniameda",
  description: "Faceless YouTube channels and the videos that work, sorted by theme.",
  robots: { index: false, follow: false },
};

export default function YouTubeLayout({ children }: { children: React.ReactNode }) {
  return <div className="yt-root">{children}</div>;
}
