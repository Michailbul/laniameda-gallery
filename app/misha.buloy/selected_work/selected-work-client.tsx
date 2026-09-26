"use client";
import { useCurrentUser } from "@/lib/use-current-user";
// The public surface. Each of its three views — Featured / Worlds / Browse —
// is its own URL under this path, so a view can be linked and bookmarked
// instead of living in component state. (The old ShowcaseHome split storybooks
// into their own stacks; storybooks are worlds now.)
import { PublicHome } from "@/components/showcase/public-home";
import type { PublicMode } from "@/lib/public-modes";
import type { FirstScreenData } from "@/components/showcase/types";

export function SelectedWorkClient({
  mode,
  firstScreen,
}: {
  mode: PublicMode;
  firstScreen?: FirstScreenData;
}) {
  const { user, isLoading } = useCurrentUser();

  // The gallery renders at once, so its Convex queries run while auth is
  // still resolving. Only the owner chrome (the Browse scope control and the
  // footer sign-in link) waits for the answer, so neither flashes wrong.
  return (
    <PublicHome
      mode={mode}
      previewAuthed={Boolean(user)}
      authPending={isLoading}
      firstScreen={firstScreen}
    />
  );
}
