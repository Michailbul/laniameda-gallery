"use client";

import { InboxGate } from "@/components/inbox/inbox-ui";
import { TasksHome } from "@/components/tasks/task-queue";

export default function TasksPage() {
  return <InboxGate title="Tasks" prompt="Sign in to see the queue">{(ownerUserId) => <TasksHome ownerUserId={ownerUserId} />}</InboxGate>;
}
