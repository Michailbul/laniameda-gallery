import type { Metadata } from "next";
import "@/app/tokens.css";
import { ReviewModal } from "@/components/gallery/review-modal";

export const metadata: Metadata = {
  title: "Direction board — Laniameda",
  description: "Shared project direction board.",
  robots: { index: false, follow: false },
};

export default async function BoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // The shared board IS the workspace review view, rendered read-only from the
  // share token — no auth, no admin controls, no collections picker.
  return <ReviewModal viewerToken={token} leftOffset="0px" />;
}
