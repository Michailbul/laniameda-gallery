"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery/dashboard";
import { ShowcaseHome } from "@/components/showcase/showcase-home";

function PageInner() {
  const { user, isLoading, signOut } = useCurrentUser();
  const searchParams = useSearchParams();
  // Owner can force the visitor view even while signed in (Preview as visitor).
  const forcePreview = searchParams.get("preview") === "1";

  // Wait for auth to resolve so the owner never flashes the public home before
  // the vault mounts.
  if (isLoading) return <RootSplash />;

  // Anonymous visitors — and the owner in preview mode — get the showcase.
  if (!user || forcePreview) {
    return <ShowcaseHome previewAuthed={Boolean(user)} />;
  }

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
