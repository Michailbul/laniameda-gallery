import { z } from "zod";

// Agent input for projects, shared by /api/agent/projects and the project_*
// MCP tools. A project is a world with project details (CASSANDRA). It
// gathers the world, its art-director shelves, the director review, the
// inspiration for it and the production briefs (what the director or the
// producers sent). Art-director scope first: everything here is Michael's
// until he promotes or publishes it (9 Nov 2026).

const world = z.string().trim().min(1).max(120).describe("The project's world: its key (cassandra), name or root collection id.");
const session = z.string().trim().max(80).optional().describe("Journal session label, e.g. cassandra-briefs-2026-11-09. Every change is journaled; world_undo reverts.");

export const BRIEF_KINDS = ["brief", "storyboard", "script", "style_guide", "references", "other"] as const;

export const projectOpenSchema = z.object({ world });

export const projectBriefsSchema = z.object({
  world: world.optional().describe("A project's briefs, newest received first."),
  query: z.string().trim().min(1).max(200).optional().describe("Words to find briefs by (title, sender, note, topics, file names): \"school brief\", \"storyboard\"."),
  brief: z.string().trim().min(1).max(200).optional().describe("One brief whole: brief:<id>, its id or its ingestKey."),
  limit: z.number().int().min(1).max(30).optional(),
});

export const projectSaveBriefSchema = z.object({
  world,
  ingestKey: z.string().trim().min(1).max(200).describe("Stable key, e.g. cassandra:brief:school-design. Saving again with it updates that brief."),
  title: z.string().trim().min(1).max(160).optional().describe("Plain words: \"School design brief\". Required for a new brief."),
  kind: z.enum(BRIEF_KINDS).optional(),
  from: z.string().trim().max(160).nullable().optional().describe("Who sent it, plain words: \"Lukáš Skalník · Fantasy Studios\". Never guess: write what is known."),
  receivedAt: z.union([z.number(), z.string()]).nullable().optional().describe("When it arrived: an ISO date (2026-11-09) or epoch ms."),
  note: z.string().trim().max(4000).nullable().optional().describe("Why it was sent and what it asks for."),
  topics: z.array(z.string().trim().min(1).max(60)).max(24).optional().describe("Places, people and subjects it is about: school, classroom, Casandra."),
  reviewFolders: z.array(z.string().trim().min(1).max(60)).max(24).optional().describe("Director-review folder slugs it informs (school, san-pancho-beach)."),
  assetIds: z.array(z.string().trim().min(1)).max(400).optional().describe("Replace the brief's pictures (asset:<id>), in order."),
  addAssetIds: z.array(z.string().trim().min(1)).max(400).optional().describe("Add pictures, keeping the ones it has."),
  groups: z.array(z.object({ label: z.string().trim().min(1).max(80), assetIds: z.array(z.string().trim().min(1)).max(400) })).max(24).optional()
    .describe("Optional sections of the pictures (\"School\", \"Metro\"). Replaces the groups; their pictures join the brief."),
  expectedRevision: z.number().int().min(1).optional(),
  session,
});

export const projectBriefFileSchema = z.object({
  step: z.enum(["upload_url", "attach"]).describe("upload_url: a one-time address to POST the file bytes to (answers {storageId}). attach: put the uploaded file on a brief."),
  brief: z.string().trim().min(1).max(200).optional().describe("attach: the brief (brief:<id>, id or ingestKey)."),
  storageId: z.string().trim().min(1).max(200).optional().describe("attach: what the upload answered."),
  name: z.string().trim().min(1).max(200).optional().describe("attach: the file's name as sent (CASSANDRA-Design_Brief-School.pdf)."),
  sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional().describe("attach: the file's hex SHA-256; a mismatch removes the upload."),
  contentType: z.string().trim().max(120).optional(),
  pages: z.number().int().min(1).max(5000).optional(),
  coverStorageId: z.string().trim().min(1).max(200).optional().describe("attach: an uploaded first-page picture (PNG or JPEG), private like the file."),
  session,
});

export const projectSetSchema = z.object({
  world,
  line: z.string().trim().max(300).nullable().optional().describe("One line: \"Animated feature for Sula Entertainment\"."),
  client: z.string().trim().max(120).nullable().optional(),
  role: z.string().trim().max(80).nullable().optional().describe("Michael's role on it: \"Art director\"."),
  people: z.array(z.object({ name: z.string().trim().min(1).max(80), role: z.string().trim().max(80).optional(), org: z.string().trim().max(120).optional() })).max(24).optional(),
  reviewSlugs: z.array(z.string().trim().min(1).max(80)).max(12).optional().describe("Review projects of this project (those pointing at the world belong to it anyway)."),
  status: z.enum(["active", "paused", "done"]).optional(),
  session,
});

/** "2026-11-09", "2026-11-09T14:21:00+01:00" or epoch ms → ms. */
export const parseWhen = (value: number | string | null | undefined): number | null | undefined => {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return value;
  const at = Date.parse(value);
  if (Number.isNaN(at)) throw new Error(`"${value}" is not a date (use 2026-11-09).`);
  return at;
};
