"use client";

import { InboxGate } from "@/components/inbox/inbox-ui";
import { MjQueueBoard } from "@/components/mj-queue/mj-queue-board";

// Every world's Midjourney queue on one page (?thread=thr-xxxxxxxx opens one
// thread). A world's own queue is its Queue tab, /w/<world>/queue.
export default function QueuePage() {
  return <InboxGate title="Midjourney queue" prompt="Sign in to see the queue">
    {(ownerUserId) => <MjQueueBoard ownerUserId={ownerUserId} standalone />}
  </InboxGate>;
}
