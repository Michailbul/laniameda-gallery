"use client";

import { MjQueueBoard } from "@/components/mj-queue/mj-queue-board";
import { WorldBoundary } from "./world-ui";

/** The Queue tab of a world: its Midjourney threads, the same rows the extension's MJ Queue tab shows. */
export function WorldQueueTab({ ownerUserId, worldKey, worldName }: {
  ownerUserId: string; worldKey: string; worldName: string;
}) {
  return <WorldBoundary resetKey={worldKey} what="Queue">
    <section className="min-h-[calc(100dvh-120px)] pt-2">
      <MjQueueBoard ownerUserId={ownerUserId} worldKey={worldKey} worldName={worldName} />
    </section>
  </WorldBoundary>;
}
