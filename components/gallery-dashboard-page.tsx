"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { GalleryDashboard } from "@/components/gallery-dashboard";

export function GalleryDashboardPage() {
  const { user, signOut } = useAuth();

  return (
    <GalleryDashboard
      user={user}
      onSignOut={signOut}
    />
  );
}
