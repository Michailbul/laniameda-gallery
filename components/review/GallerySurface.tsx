"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

// The root layout wraps every gallery page in the gallery's providers
// (Telegram session, the gallery Convex client, the feedback button). The
// director review page (/review/<slug>, also served on another domain) has
// its own client and sign-in, so it renders bare: no /api/auth/me call, no
// second websocket, no gallery chrome. The segment comes from the route
// tree, so it is "review" on the public address too.
export function GallerySurface({ gallery, children }: { gallery: ReactNode; children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return <>{segment === "review" ? children : gallery}</>;
}
