"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { ReviewDeck } from "@/components/tasks/review-deck";
import { Micro, display } from "@/components/inbox/inbox-ui";
import { WorldBoundary } from "./world-ui";

/** The Tasks tab of a world: its review deck, one card at a time. */
export function WorldTasksTab({ ownerUserId, worldFolderId, worldKey, worldName }: {
  ownerUserId: string; worldFolderId: Id<"folders">; worldKey: string; worldName: string;
}) {
  return <WorldBoundary resetKey={worldKey} what="Tasks">
    <section className="flex min-h-[calc(100dvh-120px)] flex-col px-3 pb-16 pt-2 md:px-6">
      <ReviewDeck ownerUserId={ownerUserId} worldFolderId={worldFolderId} showWorld={false}
        header={({ total, needsYou, done }) => <header className="mx-auto mb-3 w-full max-w-[760px]">
          <h2 className="text-2xl font-black uppercase leading-none tracking-tight" style={display}>Review</h2>
          <Micro className="mt-2 block">{needsYou ? <><span style={{ color: "var(--lm-coral)" }}>{needsYou} need you</span> · </> : null}{done ? `${done} to accept · ` : ""}{total} cards in {worldName}</Micro>
        </header>} />
    </section>
  </WorldBoundary>;
}
