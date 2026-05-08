const PILLAR_LABELS: Record<string, string> = {
  creators: "Creators",
  designs: "Designs",
  dump: "Dump",
};

export const resolvePillarLabel = (pillar?: string) => {
  if (!pillar) return undefined;
  return PILLAR_LABELS[pillar] ?? pillar;
};

export const formatAssetCreatedAt = (createdAt?: number) => {
  if (!createdAt) return undefined;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};
