"use client";
import { useCurrentUser } from "@/lib/use-current-user";
// One public surface, two URLs: this legacy shareable link now renders the
// same Featured / Worlds / Browse home as `/`, so published work never has to
// be curated twice. (The old ShowcaseHome split storybooks into their own
// stacks; storybooks are worlds now.)
import { PublicHome } from "@/components/showcase/public-home";

export function TasteProfileClient() {
  const { user, isLoading } = useCurrentUser();

  // Hold the splash until auth resolves so the owner-preview banner (and the
  // hidden owner sign-in link) don't flash the wrong state on load.
  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--lm-paper)" }} />
    );
  }

  return <PublicHome previewAuthed={Boolean(user)} />;
}
