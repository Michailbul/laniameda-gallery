"use client";

import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { GalleryDashboard } from "@/components/gallery-dashboard";

export default function Page() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Agent Prompter</p>
          <h1 className="text-2xl font-semibold text-foreground">Reference Library</h1>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary hover:text-primary"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/sign-in">
              <button
                type="button"
                className="rounded-full border border-primary px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/10"
              >
                Sign in with WorkOS
              </button>
            </Link>
          )}
        </div>
      </header>
      <GalleryDashboard />
    </div>
  );
}
