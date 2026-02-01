"use client";

import { ReactNode, useCallback, useEffect, useRef } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const workosClientId = process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID;
const workosRedirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
}

if (!workosClientId) {
  throw new Error("NEXT_PUBLIC_WORKOS_CLIENT_ID is not configured.");
}

if (!workosRedirectUri) {
  throw new Error("NEXT_PUBLIC_WORKOS_REDIRECT_URI is not configured.");
}

const client = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider clientId={workosClientId} redirectUri={workosRedirectUri}>
      <ConvexProviderWithAuthKit client={client} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  );
}

function useAuthFromAuthKit() {
  const { user, isLoading: authLoading } = useAuth();
  const { accessToken, loading: tokenLoading, error: tokenError } = useAccessToken();
  const loading = Boolean(authLoading) || Boolean(tokenLoading);
  const authenticated = !!user && !!accessToken && !loading && !tokenError;

  const stableAccessToken = useRef<string | null>(null);

  useEffect(() => {
    if (accessToken && !tokenError) {
      stableAccessToken.current = accessToken;
    }
  }, [accessToken, tokenError]);

  const fetchAccessToken = useCallback(async () => {
    if (stableAccessToken.current && !tokenError) {
      return stableAccessToken.current;
    }
    return null;
  }, [tokenError]);

  return {
    isLoading: loading,
    isAuthenticated: authenticated,
    fetchAccessToken,
  };
}
