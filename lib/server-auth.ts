import { getAppUser } from "@/lib/server/app-user";

export interface AuthenticatedUser {
  id: string;
  ownerUserId: string;
  convexUserId: string;
  source: "telegram";
  telegramId: string;
  name?: string;
}

export async function getAuthUser(): Promise<AuthenticatedUser | null> {
  const appUser = await getAppUser();
  if (appUser) {
    return {
      id: appUser.ownerUserId,
      ownerUserId: appUser.ownerUserId,
      convexUserId: appUser.convexUserId,
      source: "telegram",
      telegramId: appUser.telegramId ?? appUser.ownerUserId,
      name: appUser.name,
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
