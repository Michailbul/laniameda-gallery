"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AppUser, AuthMeResponse } from "@/lib/auth-types";
import { requestJson } from "@/lib/app-api";

interface TelegramAuthContextValue {
  user: AppUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const TelegramAuthContext = createContext<TelegramAuthContextValue>({
  user: null,
  isLoading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function useTelegramAuth() {
  return useContext(TelegramAuthContext);
}

const DEV_AUTH_BYPASS_ENABLED =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED ?? "").toLowerCase() === "true";

export function TelegramAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async (): Promise<AppUser | null> => {
    try {
      const data = await requestJson<AuthMeResponse>("/api/auth/me");
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchMe();
      // Dev-mode auto-login: if no session and bypass is enabled, silently
      // create one server-side and re-fetch. Persists for 30 days; subsequent
      // dev restarts skip this entirely because the cookie is still valid.
      if (!cancelled && me === null && DEV_AUTH_BYPASS_ENABLED) {
        try {
          const res = await fetch("/api/auth/dev-login", { method: "POST" });
          if (res.ok && !cancelled) await fetchMe();
        } catch {
          // dev-login route disabled / hostname not allowed; fall through to UI
        }
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchMe();
    } finally {
      setIsLoading(false);
    }
  }, [fetchMe]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return (
    <TelegramAuthContext.Provider value={{ user, isLoading, refresh, logout }}>
      {children}
    </TelegramAuthContext.Provider>
  );
}
