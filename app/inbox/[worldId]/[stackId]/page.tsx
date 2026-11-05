"use client";

import { use } from "react";
import { InboxGate } from "@/components/inbox/inbox-ui";
import { InboxStackScreen } from "@/components/inbox/stack-screen";

export default function InboxStackPage({ params }: { params: Promise<{ worldId: string; stackId: string }> }) {
  const { worldId, stackId } = use(params);
  return <InboxGate>{(ownerUserId) => <InboxStackScreen ownerUserId={ownerUserId} worldId={worldId} stackId={stackId} />}</InboxGate>;
}
