import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";

export const metadata: Metadata = {
  title: "Midjourney queue · Laniameda",
  description: "The Midjourney prompts agents prepared, thread by thread, to copy or send.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
