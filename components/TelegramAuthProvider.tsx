"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface TelegramUser {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

interface TelegramAuthContextValue {
  user: TelegramUser | null;
  isLoading: boolean;
  /** Call after the Telegram widget callback succeeds to refresh session. */
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
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      setUser(data.user ?? null);
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
