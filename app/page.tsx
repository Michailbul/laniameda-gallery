"use client";
import { useState } from "react";
import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery/dashboard";
import { LandingPage } from "@/components/landing/landing-page";

export default function Page() {
  const { user, isLoading, signOut } = useCurrentUser();
  const [guestMode, setGuestMode] = useState(false);

  if (!isLoading && !user && !guestMode) {
    return <LandingPage onContinueAsGuest={() => setGuestMode(true)} />;
  }

  const dashboardUser = user
    ? {
        id: user.ownerUserId,
        email: user.email ?? null,
        firstName: user.name ?? null,
        username: user.telegramUsername ?? null,
        photoUrl: user.avatarUrl ?? null,
        hasCompletedOnboarding: user.hasCompletedOnboarding,
      }
    : null;
  return <GalleryDashboard user={dashboardUser} onSignOut={signOut} />;
}
