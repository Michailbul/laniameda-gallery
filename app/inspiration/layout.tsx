import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";

export const metadata: Metadata = {
  title: "Inspiration · Laniameda",
  description: "Saved references and the project takes made from them.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function InspirationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
