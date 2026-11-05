"use client";

import { InboxGate } from "@/components/inbox/inbox-ui";
import { InboxHome } from "@/components/inbox/stack-list";

export default function InboxPage() {
  return <InboxGate>{(ownerUserId) => <InboxHome ownerUserId={ownerUserId} />}</InboxGate>;
}
