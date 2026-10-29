import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";

export const metadata: Metadata = {
  title: "Tasks · Laniameda",
  description: "The agent task queue: what needs you, what is in flight, what waits.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
