"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { ReviewWall } from "@/components/tasks/review-wall";
import { display } from "@/components/inbox/inbox-ui";
import { WorldBoundary } from "./world-ui";

/** The Tasks tab of a world: its row of the review wall, no world labels. */
export function WorldTasksTab({ ownerUserId, worldFolderId, worldKey, worldName }: {
  ownerUserId: string; worldFolderId: Id<"folders">; worldKey: string; worldName: string;
}) {
  return <WorldBoundary resetKey={worldKey} what="Tasks">
    <section className="flex min-h-[calc(100dvh-120px)] flex-col pt-2">
      <ReviewWall ownerUserId={ownerUserId} worldFolderId={worldFolderId} showWorlds={false} stickyHeader={false}
        header={({ counts, viewSwitch, undo }) => <header className="flex flex-wrap items-end justify-between gap-3 px-3 pt-2 md:px-6">
          <div className="min-w-0">
            <h2 className="text-2xl font-black uppercase leading-none tracking-tight" style={display}>Review</h2>
            <p className="lmw-counts">
              {counts.needsYou ? <span className="hot">{counts.needsYou} need{counts.needsYou === 1 ? "s" : ""} you</span> : null}
              {counts.toAccept ? <span className="warm">{counts.toAccept} to accept</span> : null}
              <span>{counts.total} in {worldName}</span>
            </p>
          </div>
          <div className="lmw-bar-right">{undo}{viewSwitch}</div>
        </header>} />
    </section>
  </WorldBoundary>;
}
