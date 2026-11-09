import { z } from "zod";

// Agent input for director review, shared by /api/agent/review and the
// review_* MCP tools. A review project (CASSANDRA) shows frames to an outside
// director in rounds (v0.1, v0.2 …) at its own address. Frames sit in folders
// (locations, characters, later scenes) and in styles (world styles the
// director sees as a label and a cover). Promotes land in the draft round;
// publishing makes it the round the director sees.

export const REVIEW_LIMITS = { frames: 500, folders: 100, comment: 4000, feedback: 1000 } as const;

export const REVIEW_SECTIONS = ["locations", "characters", "scenes"] as const;

const project = z.string().trim().min(1).max(80).describe(
  "The review project's slug: cassandra is the real one the director sees; cassandra-test is for trying things.",
);
const frame = z.string().trim().min(1).max(120);
const frameList = (what: string) => z.array(frame).min(1).max(REVIEW_LIMITS.frames).describe(what);
const section = z.enum(REVIEW_SECTIONS);
const folderRef = z.string().trim().min(1).max(120).describe(
  "A folder: its id, slug (san-pancho-house) or name. Add section when the same slug is in two sections.",
);
const styleRef = z.string().trim().min(1).max(200).describe(
  "A style: style:<id>, a bare id, its review label (what the director reads) or the world style's name. Case does not matter.",
);
const round = z.union([z.string().trim().min(1).max(60), z.number().int().min(0)]).describe(
  "A round: \"draft\", \"current\", a label such as \"v0.2\", or its number (2).",
);
const confirmed = z.boolean().optional().describe(
  "true only when Michael said to do this in this session. Required for publish, set_current and discard_draft: they change what the director sees or throw work away.",
);

export const reviewOpenSchema = z.object({
  project: project.optional().describe("The project's slug. Omit to list every review project."),
});

export const reviewItemsSchema = z.object({
  project,
  round: round.optional().describe("Which round. Default: the draft when there is one, else the current round."),
  folder: folderRef.optional().describe("Only this folder's frames (id, slug or name)."),
  section: section.optional().describe("Only frames in this section's folders; also picks the folder when a slug is in two sections."),
  style: styleRef.optional().describe("Only frames shown in this style."),
  frame: frame.optional().describe(
    "One frame (asset:<id>, a bare id or its code CA-XXXXXX): also returns its making-of (prompt, model, source, Midjourney data, the style's recipe).",
  ),
});

export const reviewFeedbackSchema = z.object({
  project,
  onlyNew: z.boolean().optional().describe(
    "Only what came in after Michael last marked the feedback read on the page (feedbackSeenAt). Default false: everything.",
  ),
  since: z.number().int().nonnegative().optional().describe(
    "Only events at or after this time (ms since epoch). Overrides onlyNew. Pass the cursor of your last call to read only what is new to you.",
  ),
  limit: z.number().int().min(1).max(REVIEW_LIMITS.feedback).optional().describe("Verdicts and comments each, newest first. Default 200."),
  who: z.enum(["reviewers", "all"]).optional().describe(
    "reviewers = only what the director and viewers said; all (default) = also Michael's and agents' comments and Michael's own verdicts.",
  ),
  frame: frame.optional().describe(
    "One frame (asset:<id>, a bare id or CA-XXXXXX): its whole comment thread, oldest first, with every verdict on it.",
  ),
});

export const reviewReviewerSchema = z.object({
  email: z.string().trim().min(3).max(200).describe("The Google account they sign in with."),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["director", "viewer"]).optional().describe("director (default) likes, dislikes and comments; viewer only looks."),
  title: z.string().trim().max(80).optional().describe("What they are on the film, shown by their avatar: \"Director\", \"Producer · Fantasy Studios\"."),
});

export const reviewStyleEntrySchema = z.object({
  style: styleRef,
  label: z.string().trim().max(80).optional().describe(
    "The plain name the director reads (\"Night storybook\"). Omit to keep the current label, or the style's own name for a new entry. Empty clears it.",
  ),
  hidden: z.boolean().optional().describe("Hidden styles stay in the project but the director does not see them."),
});

export const reviewProjectSchema = z.object({
  project: project.describe("The project's slug. A new slug creates the project (its address is /review/<slug>)."),
  title: z.string().trim().max(120).optional(),
  subtitle: z.string().trim().max(240).optional().describe("One line under the title. Empty clears it."),
  world: z.string().trim().min(1).max(200).optional().describe(
    "The gallery world the frames come from (key such as cassandra, name or root collection id). Style names resolve inside it.",
  ),
  publicUrl: z.string().trim().max(300).optional().describe("Where the director opens it, e.g. https://www.mishabuloichyk.com/cassandra. Empty clears it."),
  reviewers: z.array(reviewReviewerSchema).max(50).optional().describe(
    "Replaces the whole list: anyone left out loses access. Names, pictures and last visits of people kept are preserved. Prefer addReviewers/removeReviewers.",
  ),
  addReviewers: z.array(reviewReviewerSchema).max(50).optional().describe("Add these people (or change their name or role), keeping the rest."),
  removeReviewers: z.array(z.string().trim().min(3).max(200)).max(50).optional().describe("Emails to take off the list (they lose access). Only on Michael's word."),
  ownerEmails: z.array(z.string().trim().min(3).max(200)).max(10).optional().describe(
    "Google accounts that act as Michael on the public address. Replaces the list.",
  ),
  styles: z.array(reviewStyleEntrySchema).max(40).optional().describe(
    "The style carousel in order. Replaces the list; a style left out is no longer offered (its frames keep their style).",
  ),
});

export const reviewFolderEntrySchema = z.object({
  folder: folderRef.optional().describe("An existing folder to change. Omit to create one (a repeat with the same name updates it)."),
  section: section.optional().describe("Required on create: locations, characters or scenes."),
  name: z.string().trim().max(120).optional().describe("Required on create. What the director reads in the left nav."),
  slug: z.string().trim().max(80).optional().describe("On create only; default from the name. It never changes after."),
  area: z.string().trim().max(120).optional().describe("Group label in the nav (San Pancho, Mexico City, Main cast). Empty clears it."),
  note: z.string().trim().max(400).optional().describe("One plain line for the director. Empty clears it."),
  scenes: z.array(z.number().int().min(0)).max(200).optional().describe("Script scene numbers this place or person appears in."),
  order: z.number().optional().describe("Position in its section; lower first. New folders go last."),
  archived: z.boolean().optional().describe("true hides the folder from the director (its frames stay in their rounds); false brings it back."),
});

export const reviewFoldersSchema = z.object({
  project,
  folders: z.array(reviewFolderEntrySchema).min(1).max(REVIEW_LIMITS.folders).describe("Folders to create or change, in this order."),
});

export const reviewReorderFoldersSchema = z.object({
  project,
  section: section.optional().describe("The section the folders are in (helps when a slug is in two sections)."),
  order: z.array(folderRef).min(1).max(REVIEW_LIMITS.folders).describe("reorder_folders: folders in their new order. Folders left out keep their place after these."),
});

export const reviewDeleteFolderSchema = z.object({
  project,
  folder: folderRef.describe("delete_folder: the folder to delete. Only a folder with no frames in any round can go; archive the others."),
  section: section.optional(),
});

export const reviewInviteSchema = z.object({
  project,
  email: z.string().trim().min(3).max(200).describe("invite: a reviewer already on the project's list."),
});

export const REVIEW_SETUP_OPS = ["project", "folders", "reorder_folders", "delete_folder", "invite"] as const;

// review_setup takes every op's fields in one flat shape; each op reads its own.
export const reviewSetupSchema = z.object({
  op: z.enum(REVIEW_SETUP_OPS).describe(
    "project = create or change the project (title, world, address, reviewers, style carousel); folders = create or change folders (archive one with archived: true); reorder_folders = order a section's folders; delete_folder = delete an empty folder; invite = a private sign-in link for one reviewer.",
  ),
  ...reviewProjectSchema.shape,
  folders: reviewFoldersSchema.shape.folders.optional().describe("folders: the folders to create or change, in this order."),
  order: reviewReorderFoldersSchema.shape.order.optional(),
  folder: reviewDeleteFolderSchema.shape.folder.optional(),
  section: section.optional().describe("reorder_folders, delete_folder: the folders' section, when a slug is in two."),
  email: reviewInviteSchema.shape.email.optional(),
});

export const reviewPromoteSchema = z.object({
  project,
  frames: frameList("Gallery frames to show: asset:<id> or bare ids, up to 500."),
  folder: folderRef.optional().describe(
    "The folder they go into. Omit to place each frame in its suggested folder (a folder named like one of the frame's shelves); frames with no suggestion come back as unplaced.",
  ),
  section: section.optional(),
  style: styleRef.optional().describe("The style they are shown in. Omit to use the review style whose shelf holds each frame."),
  note: z.string().trim().max(400).optional().describe("Caption the director reads under each frame. Empty clears it on frames already there."),
  dryRun: z.boolean().optional().describe("Write nothing: report each frame's suggested folder and style and whether it is already in the current or draft round."),
  confirmed: z.boolean().optional().describe("true only when Michael said in this session to show these frames to the director. Required when a frame sits on a project's art-director shelf."),
});

export const REVIEW_ORGANIZE_OPS = ["move", "remove", "reorder", "replace"] as const;

export const reviewOrganizeSchema = z.object({
  project,
  op: z.enum(REVIEW_ORGANIZE_OPS).describe(
    "move = change folder, style or caption; remove = take out of the draft (earlier rounds keep them); reorder = put in this order; replace = swap one frame for its new take (the old one stays as its history).",
  ),
  items: z.array(frame).min(1).max(REVIEW_LIMITS.frames).describe(
    "Draft items as review_items lists them: item id, asset:<id>, a bare asset id or code CA-XXXXXX. A frame of the current round acts on its copy in the draft (one is made when there is no draft). replace takes exactly one.",
  ),
  inFolder: folderRef.optional().describe("Only the items in this folder, when a frame sits in two folders."),
  section: section.optional(),
  folder: folderRef.optional().describe("move: the folder they go to."),
  style: styleRef.nullable().optional().describe("move: the style they are shown in; null takes the style off."),
  note: z.string().trim().max(400).optional().describe("move: caption under each frame; empty clears it."),
  with: frame.optional().describe("replace: the new take, asset:<id> or a bare id."),
});

export const REVIEW_ROUND_OPS = ["draft", "publish", "set_current", "discard_draft"] as const;

export const reviewRoundSchema = z.object({
  project,
  op: z.enum(REVIEW_ROUND_OPS).describe(
    "draft = start the next round now (a copy of the current one, or of round); publish = the draft becomes what the director sees; set_current = show an earlier (or later) published round instead, e.g. a rollback; discard_draft = throw the draft away.",
  ),
  round: round.optional().describe("set_current: the published round to show. draft: copy this round instead of the current one (only when there is no draft)."),
  title: z.string().trim().max(120).optional().describe("publish: a short title for the round (\"New locations\")."),
  note: z.string().trim().max(1000).optional().describe("publish: a plain note to the director about what changed."),
  label: z.string().trim().max(20).optional().describe("publish: override the label (default v0.<number>)."),
  confirmed,
});

export const REVIEW_COMMENT_OPS = ["add", "resolve", "reopen", "delete", "mark_seen"] as const;

export const reviewCommentSchema = z.object({
  project,
  op: z.enum(REVIEW_COMMENT_OPS).describe(
    "add = reply on frames as the studio agent; resolve / reopen = mark a comment handled or open again; delete = remove a comment (your own replies, or on Michael's word); mark_seen = set Michael's \"read up to now\" mark (only on his word: it clears his unread count).",
  ),
  frames: z.array(frame).max(REVIEW_LIMITS.frames).optional().describe("add: the frames (asset:<id>, bare id or CA-XXXXXX); one comment row per frame."),
  body: z.string().trim().max(REVIEW_LIMITS.comment).optional().describe("add: plain text the director reads, at most 4000 characters."),
  commentId: z.string().trim().min(1).max(120).optional().describe("resolve, reopen, delete: the commentId from review_feedback."),
});
