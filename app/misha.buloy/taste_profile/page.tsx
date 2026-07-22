import type { Metadata } from "next";
import { TasteProfileClient } from "./taste-profile-client";

// Public, shareable surface — its own link-preview identity, separate from the
// gallery home at `/`.
export const metadata: Metadata = {
  title: "Misha Buloy — Taste Profile · Laniameda",
  description:
    "Taste, and the work it makes. AI filmmaker and image-maker — story sets, stills, and locations.",
};

export default function TasteProfilePage() {
  return <TasteProfileClient />;
}
