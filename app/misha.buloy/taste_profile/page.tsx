import type { Metadata } from "next";
import "@/app/tokens.css";
import { TasteProfileClient } from "./taste-profile-client";

// Public, shareable surface — its own link-preview identity, separate from the
// gallery home at `/`.
export const metadata: Metadata = {
  title: "Misha Buloy — Taste Profile · Laniameda",
  description:
    "Taste, and the work it makes. AI filmmaker and image-maker — story sets, stills, and locations.",
};

export default function TasteProfilePage() {
  // The public showcase keeps its dark editorial art direction regardless of
  // the viewer's gallery theme — the theme toggle is a vault-side preference.
  return (
    <div data-theme="dark" style={{ background: "var(--lm-paper)" }}>
      <TasteProfileClient />
    </div>
  );
}
