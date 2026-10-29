"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { WorldView } from "@/components/showcase/world-view";
import { GalleryRoot, GallerySplash } from "@/components/gallery/gallery-root";

/** Query flag that shows the public page of a world to its signed-in owner. */
export const PUBLIC_VIEW_PARAM = "public";

/**
 * /w/<slug> serves two readers. A visitor gets the public world page (the
 * showcase). The owner, signed in, gets the vault opened on that world: the
 * same address an agent pastes and the dashboard writes while browsing.
 * `?public=1` lets the owner see the public page anyway.
 */
function WorldEntryInner({ slug }: { slug: string }) {
  const { user, isLoading } = useCurrentUser();
  const wantsPublic = useSearchParams().get(PUBLIC_VIEW_PARAM) === "1";
  if (isLoading) return <GallerySplash />;
  if (user && !wantsPublic) return <GalleryRoot />;
  return <WorldView slug={slug} />;
}

export function WorldEntry({ slug }: { slug: string }) {
  return (
    <Suspense fallback={<GallerySplash />}>
      <WorldEntryInner slug={slug} />
    </Suspense>
  );
}
