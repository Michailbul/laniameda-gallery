import { canActorAccessByUserId, parseUserIdList } from "@/lib/identity";

export const getCurationAdminUserIds = () =>
  parseUserIdList(
    process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID,
  );

export const isCurationAdmin = (actorUserId: string | undefined | null) => {
  if (!actorUserId) return false;
  return canActorAccessByUserId(actorUserId, getCurationAdminUserIds());
};

export const getCurationAdminSecret = () =>
  (process.env.CURATION_ADMIN_SECRET ?? "").trim();
