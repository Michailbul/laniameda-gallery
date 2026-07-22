"use client";
import { Suspense } from "react";
import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery/dashboard";

function PageInner() {
  const { user, isLoading, signOut } = useCurrentUser();

  // Wait for auth to resolve so the owner never flashes the public gallery
  // scope before their private vault mounts.
  if (isLoading) return <RootSplash />;

  // The gallery is the home page for everyone. Anonymous visitors get the
  // public scope (published collections) with a login button in the sidebar;
  // the owner gets their full vault. The taste profile lives at its own URL
  // (lib/routes.ts TASTE_PROFILE_PATH).
  if (!user) {
    return <GalleryDashboard />;
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
