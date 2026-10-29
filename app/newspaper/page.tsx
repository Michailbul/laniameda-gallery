"use client";

import { InboxGate } from "@/components/inbox/inbox-ui";
import { NewspaperScreen } from "@/components/newspaper/newspaper";

/** /newspaper: the latest edition. */
export default function NewspaperPage() {
  return <InboxGate title="Newspaper" prompt="Sign in to read this morning's paper">{(ownerUserId) => <NewspaperScreen ownerUserId={ownerUserId} />}</InboxGate>;
}
