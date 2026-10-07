import { z } from "zod";

// Stored in the existing, private bendIdea field. No second research database.
const evidence = z.object({
  id: z.string().regex(/^[\w-]{11}$/),
  title: z.string().min(1),
  views: z.number().int().nonnegative(),
});
const reading = z.object({ summary: z.string().min(1), evidence: z.array(evidence).max(3) });
const optionalReading = z.object({ summary: z.string().trim().min(1), evidence: z.array(evidence).max(3) });
const audienceFit = optionalReading.extend({
  verdict: z.enum(["Supported", "Partial", "Unknown", "Mismatch"]),
});
export type EvidenceVideo = z.infer<typeof evidence>;
const bend = z.object({
  niche: z.string().min(1),
  title: z.string().min(1),
  verdict: z.enum(["Confirmed", "Open", "Contested", "Crowded", "Weak", "Untested"]),
  why: z.string().min(1),
  tension: z.string().min(1),
  urgency: z.string().min(1),
  thumbnail: z.string().min(1),
  style: z.string().min(1),
  // Optional V1 extensions keep previously saved proposals readable. Evidence
  // videos support visual comparisons; view counts never infer demographics.
  audienceFit: audienceFit.optional(),
  adaptation: z.string().trim().min(1).optional(),
  previousAttempts: optionalReading.optional(),
  urgencyEvidence: z.object({
    summary: z.string().trim().min(1),
    url: z.string().url().startsWith("https://"),
  }).optional(),
  format: z.string().min(1),
  first30: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  demand: reading,
  saturation: reading,
  externalDemand: z.object({ source: z.string(), summary: z.string(), url: z.string().url().startsWith("https://") }),
  toCheck: z.array(z.string()),
});

export const researchSchema = z.object({
  v: z.literal(1),
  checkedAt: z.string().datetime({ offset: true }),
  sourceVerdict: z.enum(["Proven", "Format only"]),
  validation: z.string().min(1),
  bends: z.array(bend).min(1).max(3),
});

export type Research = z.infer<typeof researchSchema>;

export const parseResearch = (value: string | undefined): Research | null => {
  if (!value || value.length > 4000) return null;
  try {
    const parsed = researchSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

// Labels merge on refresh. A current, explicit failure takes precedence over
// historical eligibility labels without deleting the owner's saved metadata.
export const currentResearchTags = (row: { bendIdea?: string; tagNames?: string[] }) =>
  parseResearch(row.bendIdea)?.sourceVerdict === "Format only"
    ? (row.tagNames ?? []).filter((tag) => !["passes-filters", "fresh-channel"].includes(tag))
    : (row.tagNames ?? []);

// This decision is made before data is serialized to the browser. A shared
// YouTube password grants access to references, never to the owner's ideas.
export const privateResearchFields = (
  row: { bendIdea?: string; userNote?: string; isLiked?: boolean },
  isOwner: boolean,
) => isOwner ? { bendIdea: row.bendIdea, userNote: row.userNote, isLiked: row.isLiked } : {};
