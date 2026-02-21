"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { GalleryDashboard } from "@/components/gallery-dashboard";

export default function Page() {
  const { user, signOut } = useAuth();

  return (
    <GalleryDashboard
      user={user}
      onSignOut={signOut}
    />
  );
}
