"use client";

import { InboxGate } from "@/components/inbox/inbox-ui";
import { InspirationLibrary } from "@/components/inspiration/inspiration-library";

/** /inspiration: the owner's library of saved references and their project takes. */
export default function InspirationPage() {
  return <InboxGate title="Inspiration" prompt="Sign in to see your references">{(ownerUserId) => <InspirationLibrary ownerUserId={ownerUserId} />}</InboxGate>;
}
