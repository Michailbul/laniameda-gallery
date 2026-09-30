"use client";

import { ReactNode, useCallback, useMemo } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useTelegramAuth } from "@/components/TelegramAuthProvider";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
}

const client = new ConvexReactClient(convexUrl);

// Convex learns who the browser is from a short-lived token minted by
// /api/auth/convex-token for the Telegram session. Anonymous visitors get no
// token and can still read the public showcase queries.
function useGalleryConvexAuth() {
  const { user, isLoading } = useTelegramAuth();
  const ownerUserId = user?.ownerUserId;

  const fetchAccessToken = useCallback(async () => {
    if (!ownerUserId) return null;
    try {
      const response = await fetch("/api/auth/convex-token", { cache: "no-store" });
      if (!response.ok) return null;
      const data = (await response.json()) as { token?: string | null };
      return data.token ?? null;
    } catch {
      return null;
    }
  }, [ownerUserId]);

  return useMemo(
    () => ({
      isLoading,
      isAuthenticated: Boolean(ownerUserId),
      fetchAccessToken,
    }),
    [isLoading, ownerUserId, fetchAccessToken],
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={client} useAuth={useGalleryConvexAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
