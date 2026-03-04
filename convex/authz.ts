export const parseUserIdList = (rawValue: string | undefined) =>
  (rawValue ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const resolveUserIdCandidates = (userId: string) => {
  const normalized = userId.trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  if (normalized.startsWith("telegram:")) {
    const unprefixed = normalized.slice("telegram:".length).trim();
    if (unprefixed) {
      candidates.push(unprefixed);
    }
  } else if (/^\d+$/.test(normalized)) {
    candidates.push(`telegram:${normalized}`);
  }

  return Array.from(new Set(candidates));
};

export const canActorAccessByUserId = (
  actorUserId: string,
  allowedUserIds: string[],
) => {
  if (!actorUserId.trim() || allowedUserIds.length === 0) return false;
  const candidates = resolveUserIdCandidates(actorUserId);
  return candidates.some((candidate) => allowedUserIds.includes(candidate));
};

export const canActorAccessOwnerUserId = (
  actorUserId: string,
  ownerUserId: string | undefined,
) => {
  if (!ownerUserId?.trim()) return false;
  return canActorAccessByUserId(actorUserId, [ownerUserId.trim()]);
};
