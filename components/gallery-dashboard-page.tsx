"use client";

import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery-dashboard";

export function GalleryDashboardPage() {
  const { user, signOut } = useCurrentUser();

  const dashboardUser = user
    ? {
        id: user.ownerUserId,
        email: user.email ?? null,
        firstName: user.name ?? null,
        username: user.telegramUsername ?? null,
        photoUrl: user.avatarUrl ?? null,
      }
    : null;

  return (
    <GalleryDashboard
      user={dashboardUser}
      onSignOut={signOut}
    />
  );
}
