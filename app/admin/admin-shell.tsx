"use client";

import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery/dashboard";

interface AdminShellProps {
  user: {
    id?: string | null;
    email?: string | null;
    firstName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
  };
}

export function AdminShell({ user }: AdminShellProps) {
  const { signOut } = useCurrentUser();
  return <GalleryDashboard user={user} onSignOut={signOut} adminMode />;
}
