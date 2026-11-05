import type { Infer } from "convex/values";
import type { midjourneyMetadataFields } from "@/convex/validators";

export type MidjourneyMetadata = Infer<typeof midjourneyMetadataFields>;
type Personalization = MidjourneyMetadata["personalization"][number];

const JOB_ID = /^[0-9a-f-]{20,64}$/i;
const MAX_LIST = 32;

const cleanString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
};

const cleanNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const cleanStrings = (value: unknown, maxLength: number) => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => cleanString(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_LIST);
  return items.length > 0 ? items : undefined;
};

const cleanPersonalization = (value: unknown): Personalization[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_LIST).flatMap((raw): Personalization[] => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Record<string, unknown>;
    const code = cleanString(entry.code, 64);
    if (!code) return [];
    const name = cleanString(entry.name, 200);
    const id = cleanString(entry.id, 64);
    return [{
      code,
      type: entry.type === "moodboard" || entry.type === "profile" ? entry.type : "unknown",
      ...(name ? { name } : {}),
      ...(id ? { id } : {}),
    }];
  });
};

/**
 * The extension's metadata, cut down to what the asset field accepts. It comes
 * from a browser and scrapes a third-party page, so anything off-shape is left
 * out, and the job URL is rebuilt here instead of trusting a link from the client.
 */
export function sanitizeMidjourneyMetadata(value: unknown): MidjourneyMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
  if (!JOB_ID.test(jobId)) return undefined;

  const index = cleanNumber(input.tileIndex);
  const tileIndex = index !== undefined && Number.isInteger(index) && index >= 0 ? index : undefined;
  const optional: Partial<MidjourneyMetadata> = {
    tileIndex,
    aspectRatio: cleanString(input.aspectRatio, 32),
    stylize: cleanNumber(input.stylize),
    chaos: cleanNumber(input.chaos),
    raw: input.raw === true ? true : undefined,
    version: cleanString(input.version, 32),
    seed: cleanString(input.seed, 32),
    hd: input.hd === true ? true : undefined,
    speed: cleanString(input.speed, 16),
    no: cleanStrings(input.no, 300),
    otherFlags: cleanStrings(input.otherFlags, 500),
  };

  return {
    jobId,
    jobUrl: `https://www.midjourney.com/jobs/${jobId}${tileIndex !== undefined ? `?index=${tileIndex}` : ""}`,
    personalization: cleanPersonalization(input.personalization),
    ...Object.fromEntries(
      Object.entries(optional).filter(([, field]) => field !== undefined),
    ),
  };
}

/** The job's settings as Midjourney flags, in the order they read best. */
export function midjourneySettingFlags(metadata: MidjourneyMetadata): string[] {
  return [
    metadata.aspectRatio && `--ar ${metadata.aspectRatio}`,
    metadata.stylize !== undefined && `--stylize ${metadata.stylize}`,
    metadata.chaos !== undefined && `--chaos ${metadata.chaos}`,
    metadata.raw && "--raw",
    metadata.version && `--v ${metadata.version}`,
    metadata.seed && `--seed ${metadata.seed}`,
    metadata.hd && "--hd",
    metadata.speed && `--${metadata.speed}`,
    metadata.no?.length && `--no ${metadata.no.join(", ")}`,
    ...(metadata.otherFlags ?? []),
  ].filter((flag): flag is string => typeof flag === "string" && flag.length > 0);
}
