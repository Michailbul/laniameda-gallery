"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery/dashboard";
import { TASTE_PROFILE_PATH } from "@/lib/routes";

function PageInner() {
  const { user, isLoading, signOut } = useCurrentUser();
  const router = useRouter();
  // ?preview=visitor used to render the public surface inline here. The public
  // surface now has exactly one URL, so this just forwards to it.
  const previewVisitor = useSearchParams().get("preview") === "visitor";

  // `/` is the gallery workbench, for the owner only. `proxy.ts` already bounces
  // signed-out visitors to the taste profile at the edge; this covers the paths
  // that never touch the edge (bfcache restores, a session that dies mid-visit)
  // so the vault shell can't sit here empty for someone with no session.
  const leaveRoot = !isLoading && (!user || previewVisitor);
  useEffect(() => {
    if (leaveRoot) router.replace(TASTE_PROFILE_PATH);
  }, [leaveRoot, router]);

  // Wait for auth to resolve so the owner never flashes the public gallery
  // scope before their private vault mounts. `!user` is redundant with
  // `leaveRoot` but keeps the vault behind a check the compiler can see.
  if (isLoading || leaveRoot || !user) return <RootSplash />;

  const dashboardUser = {
    id: user.ownerUserId,
    email: user.email ?? null,
    firstName: user.name ?? null,
    username: user.telegramUsername ?? null,
    photoUrl: user.avatarUrl ?? null,
  };
  return <GalleryDashboard user={dashboardUser} onSignOut={signOut} />;
}

function RootSplash() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--lm-paper)",
      }}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<RootSplash />}>
      <PageInner />
    </Suspense>
  );
}
