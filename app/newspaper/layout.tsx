import type { Metadata, Viewport } from "next";
import "@/app/tokens.css";

export const metadata: Metadata = {
  title: "Newspaper · Laniameda",
  description: "The morning newspaper: what was done, what needs you, the questions and decisions.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function NewspaperLayout({ children }: { children: React.ReactNode }) {
  return children;
}
