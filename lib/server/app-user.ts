import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AppUser } from "@/lib/auth-types";
import type { TelegramUser } from "@/lib/telegram-auth";
import { getSessionUser } from "@/lib/telegram-auth";
import { getServerConvexClient } from "@/lib/server/convex";

type ConvexUser = {
  _id: Id<"users">;
  ownerUserId: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  telegramId?: string;
};

const toAppUser = (sessionUser: TelegramUser, convexUser: ConvexUser): AppUser => {
  return {
    id: convexUser._id,
    convexUserId: convexUser._id,
    ownerUserId: convexUser.ownerUserId,
    name: convexUser.name ?? sessionUser.firstName,
    avatarUrl: convexUser.avatarUrl ?? sessionUser.photoUrl,
    email: convexUser.email,
    telegramId: convexUser.telegramId ?? sessionUser.telegramId,
    telegramUsername: sessionUser.username,
  };
};

const resolveOrCreateByTelegramSession = async (
  sessionUser: TelegramUser,
): Promise<ConvexUser> => {
  const client = getServerConvexClient();
  const existing = await client.query(api.users.resolveByTelegramId, {
    telegramId: sessionUser.telegramId,
  });

  if (existing) {
    return existing;
  }

  return await client.mutation(api.users.resolveOrCreateByTelegram, {
    telegramId: sessionUser.telegramId,
    name: [sessionUser.firstName, sessionUser.lastName].filter(Boolean).join(" "),
    avatarUrl: sessionUser.photoUrl,
  });
};

export async function getAppUser(): Promise<AppUser | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return null;
  }

  const convexUser = await resolveOrCreateByTelegramSession(sessionUser);
  return toAppUser(sessionUser, convexUser);
}

export async function requireAppUser(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) {
    throw new Error("Not authenticated.");
  }
  return user;
}
