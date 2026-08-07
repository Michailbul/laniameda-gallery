"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { TelegramLoginButton } from "@/components/telegram-login-button";

// Rendered when the server saw no session on /admin. Signing in happens over in
// Telegram, so the session lands on the client with the server's answer already
// baked — refresh once the user turns up so the page re-runs and hands them the
// console (or bounces them to their vault, if they aren't a curation admin).
export function AdminSignIn() {
  const { user, isLoading } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user) router.refresh();
  }, [isLoading, user, router]);

  if (isLoading || user) {
    return <main className="min-h-screen bg-[var(--paper)]" />;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-4">
      <div className="w-full max-w-sm">
        <TelegramLoginButton size="large" />
      </div>
    </main>
  );
}
