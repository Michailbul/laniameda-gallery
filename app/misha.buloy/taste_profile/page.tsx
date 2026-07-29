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
  // Follows the viewer's theme from <html data-theme>, same as the rest of the
  // site. This used to pin data-theme="dark", which silently won over the root
  // attribute and made the theme toggle in the public nav look broken here.
  // Every color in the client comes from tokens, so both themes render.
  return (
    <div style={{ background: "var(--lm-paper)" }}>
      <TasteProfileClient />
    </div>
  );
}
