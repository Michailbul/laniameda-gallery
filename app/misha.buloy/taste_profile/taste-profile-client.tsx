"use client";
import { useCurrentUser } from "@/lib/use-current-user";
// The public surface. Each of its three views — Featured / Worlds / Browse —
// is its own URL under this path, so a view can be linked and bookmarked
// instead of living in component state. (The old ShowcaseHome split storybooks
// into their own stacks; storybooks are worlds now.)
import { PublicHome } from "@/components/showcase/public-home";
import type { PublicMode } from "@/lib/public-modes";

export function TasteProfileClient({ mode }: { mode: PublicMode }) {
  const { user, isLoading } = useCurrentUser();

  // Hold the splash until auth resolves so the owner-preview banner (and the
  // hidden owner sign-in link) don't flash the wrong state on load.
  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--lm-paper)" }} />
    );
  }

  return <PublicHome mode={mode} previewAuthed={Boolean(user)} />;
}
