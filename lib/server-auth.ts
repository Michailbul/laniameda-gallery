import { getSessionUser, type TelegramUser } from "@/lib/telegram-auth";

export interface AuthenticatedUser {
  id: string;
  source: "telegram";
  telegramId: string;
  name?: string;
}

export async function getAuthUser(): Promise<AuthenticatedUser | null> {
  const telegramUser: TelegramUser | null = await getSessionUser();
  if (telegramUser) {
    return {
      id: telegramUser.telegramId,
      source: "telegram",
      telegramId: telegramUser.telegramId,
      name: [telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(" ") || undefined,
    };
  }

  return null;
}

export async function requireAuth(): Promise<AuthenticatedUser> {
  const user = await getAuthUser();
  if (!user) {
    throw new Error("Not authenticated.");
  }
  return user;
}
