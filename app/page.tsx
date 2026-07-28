"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery/dashboard";
import { PublicHome } from "@/components/showcase/public-home";

function PageInner() {
  const { user, isLoading, signOut } = useCurrentUser();
  // ?preview=visitor renders the public surface while signed in, so the owner
  // can check what a visitor sees without signing out.
  const previewVisitor = useSearchParams().get("preview") === "visitor";

  // Wait for auth to resolve so the owner never flashes the public gallery
  // scope before their private vault mounts.
  if (isLoading) return <RootSplash />;

  // Two different products behind one URL. Anonymous visitors get the curated
  // public surface — Featured work / Worlds / Browse, no sidebar, no filter
  // bar. The owner gets the full vault workbench, unchanged.
  if (!user) {
    return <PublicHome />;
  }
  if (previewVisitor) {
    return <PublicHome previewAuthed />;
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
