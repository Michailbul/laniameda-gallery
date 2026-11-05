"use client";

import { use } from "react";
import { InboxGate } from "@/components/inbox/inbox-ui";
import { WorldInbox } from "@/components/inbox/stack-list";

export default function WorldInboxPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = use(params);
  return <InboxGate>{(ownerUserId) => <WorldInbox ownerUserId={ownerUserId} worldId={worldId} />}</InboxGate>;
}
