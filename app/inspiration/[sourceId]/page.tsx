"use client";

import { use } from "react";
import { InboxGate } from "@/components/inbox/inbox-ui";
import { InspirationReview } from "@/components/inspiration/inspiration-review";

/** /inspiration/<sourceId>: one reference beside its project takes. */
export default function InspirationSourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = use(params);
  return <InboxGate title="Inspiration" prompt="Sign in to review this reference">{(ownerUserId) => <InspirationReview ownerUserId={ownerUserId} sourceId={decodeURIComponent(sourceId)} />}</InboxGate>;
}
