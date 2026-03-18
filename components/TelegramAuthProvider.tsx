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

export function TelegramAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const data = await requestJson<AuthMeResponse>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchMe();
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
