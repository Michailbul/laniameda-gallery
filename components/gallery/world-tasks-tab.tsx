"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { TaskQueue } from "@/components/tasks/task-queue";
import { Micro, display } from "@/components/inbox/inbox-ui";
import { WorldBoundary } from "./world-ui";

/** The Tasks tab of a world: its queue, filed into this world. */
export function WorldTasksTab({ ownerUserId, worldFolderId, worldKey, worldName }: {
  ownerUserId: string; worldFolderId: Id<"folders">; worldKey: string; worldName: string;
}) {
  return <WorldBoundary resetKey={worldKey} what="Tasks">
    <section className="px-2 pb-16 pt-2 md:px-4">
      <TaskQueue ownerUserId={ownerUserId} worldFolderId={worldFolderId} showWorld={false}
        header={({ active, blocked }) => <header className="mb-3 px-3 md:px-4">
          <h2 className="text-2xl font-black uppercase leading-none tracking-tight" style={display}>Tasks</h2>
          <Micro className="mt-2 block">{blocked ? <><span style={{ color: "var(--lm-coral)" }}>{blocked} need you</span> · </> : null}{active} active in {worldName} · agents see them in open_world</Micro>
        </header>} />
    </section>
  </WorldBoundary>;
}
