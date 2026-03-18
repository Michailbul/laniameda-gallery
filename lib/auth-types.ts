export interface AppUser {
  id: string;
  convexUserId: string;
  ownerUserId: string;
  name: string;
  avatarUrl?: string;
  email?: string;
  telegramId?: string;
  telegramUsername?: string;
}

export interface AuthMeResponse {
  user: AppUser | null;
}
