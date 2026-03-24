"use client";

import type { AppUser } from "@/lib/auth-types";
import { useTelegramAuth } from "@/components/TelegramAuthProvider";

interface UseCurrentUserResult {
  user: AppUser | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

export function useCurrentUser(): UseCurrentUserResult {
  const { user, isLoading, logout } =
    useTelegramAuth();

  return {
    user,
    isLoading,
    signOut: logout,
  };
}
