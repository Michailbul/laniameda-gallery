import type { Metadata } from "next";
import "@/app/tokens.css";
import { DirectionBoard } from "@/components/board/direction-board";

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
  return <DirectionBoard token={token} />;
}
