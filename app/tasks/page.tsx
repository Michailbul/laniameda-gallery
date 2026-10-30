"use client";

import { InboxGate } from "@/components/inbox/inbox-ui";
import { TasksDeckHome } from "@/components/tasks/review-deck";

export default function TasksPage() {
  return <InboxGate title="Review" prompt="Sign in to review">{(ownerUserId) => <TasksDeckHome ownerUserId={ownerUserId} />}</InboxGate>;
}
