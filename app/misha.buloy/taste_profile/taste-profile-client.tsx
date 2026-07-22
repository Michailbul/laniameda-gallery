"use client";
import { useCurrentUser } from "@/lib/use-current-user";
import { ShowcaseHome } from "@/components/showcase/showcase-home";

export function TasteProfileClient() {
  const { user, isLoading } = useCurrentUser();

  // Hold the splash until auth resolves so the owner-preview banner (and the
  // hidden owner sign-in link) don't flash the wrong state on load.
  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--lm-paper)" }} />
    );
  }

  return <ShowcaseHome previewAuthed={Boolean(user)} />;
}
