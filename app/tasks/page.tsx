"use client";

import { InboxGate } from "@/components/inbox/inbox-ui";
import { ReviewWallHome } from "@/components/tasks/review-wall";

export default function TasksPage() {
  return <InboxGate title="Review" prompt="Sign in to review">{(ownerUserId) => <ReviewWallHome ownerUserId={ownerUserId} />}</InboxGate>;
}
