"use client";

import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { Button } from "@/components/ui/button";

export function AuthBanner() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isAuthenticated || isLoading) {
    return null;
  }

  return (
    <section className="mx-auto mb-6 max-w-5xl rounded-2xl border border-primary/50 bg-primary/5 px-6 py-4 text-sm text-primary-foreground shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="text-base font-medium text-primary-foreground">
          Access the full experience—sign in to like, save, or add references to your
          collection.
        </p>
        <Link href="/sign-in" className="self-start md:self-auto">
          <Button variant="default" size="sm">
            Sign in with WorkOS
          </Button>
        </Link>
      </div>
    </section>
  );
}
