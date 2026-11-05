"use client";

import { Suspense } from "react";
import { InboxGate } from "@/components/inbox/inbox-ui";
import { SettingsPage } from "@/components/settings/settings-page";

export default function Settings() {
  return (
    <InboxGate title="Settings" prompt="Sign in to change settings">
      {(ownerUserId) => <Suspense><SettingsPage ownerUserId={ownerUserId} /></Suspense>}
    </InboxGate>
  );
}
