"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { GalleryDashboard } from "@/components/gallery/dashboard";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import Link from "next/link";
import { PUBLIC_HOME_PATH } from "@/lib/public-modes";

function PageInner() {
  const { user, isLoading, signOut } = useCurrentUser();
  const router = useRouter();
  // ?preview=visitor used to render the public surface inline here. The public
  // surface now has exactly one URL, so this just forwards to it.
  const previewVisitor = useSearchParams().get("preview") === "visitor";

  // Public previews have their own address. The gallery address itself stays
  // accessible when signed out so an expired session leads straight to login.
  const leaveRoot = !isLoading && previewVisitor;
  useEffect(() => {
    if (leaveRoot) router.replace(PUBLIC_HOME_PATH);
  }, [leaveRoot, router]);

  if (isLoading || leaveRoot) return <RootSplash />;
  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--lm-paper)] px-4">
        <div className="w-full max-w-sm">
          <h1 className="mb-6 text-center text-2xl font-semibold text-[var(--lm-text-primary)]">
            Laniameda Gallery
          </h1>
          <TelegramLoginButton size="large" />
          <Link
            href={PUBLIC_HOME_PATH}
            className="mt-6 block text-center text-sm text-[var(--lm-text-secondary)] underline underline-offset-4"
          >
            View selected work
          </Link>
        </div>
      </main>
    );
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
