"use client";

import { use } from "react";
import { InboxGate } from "@/components/inbox/inbox-ui";
import { NewspaperScreen } from "@/components/newspaper/newspaper";

/** /newspaper/2026-10-30: one edition by its Prague date. */
export default function NewspaperDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  return <InboxGate title="Newspaper" prompt="Sign in to read this edition">{(ownerUserId) => <NewspaperScreen ownerUserId={ownerUserId} date={date} />}</InboxGate>;
}
