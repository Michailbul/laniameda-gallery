"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTelegramAuth } from "@/components/TelegramAuthProvider";
import { api } from "@/convex/_generated/api";

export interface CurrentUser {
  id: string;
  ownerUserId: string;
  name: string;
  avatarUrl?: string;
  email?: string;
  telegramId?: string;
  telegramUsername?: string;
  convexUserId: string;
}

interface UseCurrentUserResult {
  user: CurrentUser | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

export function useCurrentUser(): UseCurrentUserResult {
  const { user: telegramUser, isLoading: telegramLoading, logout: telegramLogout } = useTelegramAuth();

  const resolveByTelegram = useMutation(api.users.resolveOrCreateByTelegram);
  const mutationFiredRef = useRef<string | null>(null);

  const existingTelegramUser = useQuery(
    api.users.resolveByTelegramId,
    telegramUser?.telegramId ? { telegramId: telegramUser.telegramId } : "skip",
  );

  // Fire mutation once when query returns null (user doesn't exist yet).
  // existingTelegramUser is undefined while loading, null when not found.
  useEffect(() => {
    if (!telegramUser) {
      mutationFiredRef.current = null;
      return;
    }
    // Wait for query to finish loading (undefined = loading, null = not found)
    if (existingTelegramUser === undefined) return;
    // Already found — no need to create
    if (existingTelegramUser !== null) return;
    // Already fired for this user
    if (mutationFiredRef.current === telegramUser.telegramId) return;

    mutationFiredRef.current = telegramUser.telegramId;
    resolveByTelegram({
      telegramId: telegramUser.telegramId,
      name: [telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(" "),
      avatarUrl: telegramUser.photoUrl,
    }).catch(() => {
      // Reset ref so it can retry on next render
      mutationFiredRef.current = null;
    });
  }, [telegramUser, existingTelegramUser, resolveByTelegram]);

  const currentUser = useMemo((): CurrentUser | null => {
    if (!telegramUser || !existingTelegramUser) return null;

    return {
      id: existingTelegramUser._id,
      ownerUserId: existingTelegramUser.ownerUserId,
      name: existingTelegramUser.name ?? telegramUser.firstName,
      avatarUrl: existingTelegramUser.avatarUrl ?? telegramUser.photoUrl,
      email: existingTelegramUser.email,
      telegramId: existingTelegramUser.telegramId,
      telegramUsername: telegramUser.username,
      convexUserId: existingTelegramUser._id,
    };
  }, [telegramUser, existingTelegramUser]);

  const isLoading = telegramLoading || (telegramUser != null && existingTelegramUser === undefined);

  const signOut = useCallback(async () => {
    await telegramLogout();
  }, [telegramLogout]);

  return { user: currentUser, isLoading, signOut };
}
