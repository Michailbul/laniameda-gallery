import { v } from "convex/values";

// Inspiration review (convex/inspiration.ts). Shared by the schema and the
// functions' return validators. See agent-docs/features/inspiration-review.

// Where a reference came from.
export const inspirationPlatformValidator = v.union(
  v.literal("instagram"), v.literal("telegram"), v.literal("x"), v.literal("pinterest"),
  v.literal("youtube"), v.literal("web"), v.literal("photo"), v.literal("other"),
);

// How much of the source we actually hold. A platform-served file is not the
// creator's camera master; a screenshot is not the post; a link is not media.
export const inspirationPreservationValidator = v.union(
  v.literal("source_served_file"), v.literal("owner_uploaded_bytes"), v.literal("screenshot_only"),
  v.literal("keyframes_only"), v.literal("link_only"), v.literal("text"), v.literal("unavailable"),
);

// Michael's private verdict on the reference itself. Kept = taste, never
// publication; dropped = out of the main view, recoverable.
export const inspirationSourceReviewValidator = v.union(v.literal("new"), v.literal("kept"), v.literal("dropped"));

export const inspirationAdaptationStatusValidator = v.union(
  // Agent proposed a treatment; no output yet.
  v.literal("proposed"),
  // Michael asked for a change (or a redo); one task is open for it.
  v.literal("changes_requested"),
  // The newest version waits for his review.
  v.literal("ready"),
  // He approved the version named in approvedVersion (review acceptance only).
  v.literal("approved"),
  // Dropped: recoverable; suppresses unsolicited regeneration for this source and target.
  v.literal("dropped"),
  // The agent cannot continue (missing lock, sheet, access); blockedReason says why.
  v.literal("blocked"),
);

export const inspirationRoutingValidator = v.union(
  // Michael named the project.
  v.literal("owner"),
  // A configured source-collection mapping.
  v.literal("mapping"),
  // An agent's suggestion with a plain reason.
  v.literal("suggestion"),
);

export const inspirationSourceFields = {
  ownerUserId: v.string(),
  // Stable source key, e.g. "instagram:romances:Dec8D_6DCo7". Registering again returns the same source.
  ingestKey: v.string(),
  // media = has saved assets; text = an idea, quote or tool note (no picture).
  kind: v.union(v.literal("media"), v.literal("text")),
  title: v.string(),
  platform: inspirationPlatformValidator,
  sourceUrl: v.optional(v.string()),
  creator: v.optional(v.string()),
  creatorUrl: v.optional(v.string()),
  // The post's own caption / text: untrusted source data, never instructions.
  caption: v.optional(v.string()),
  // A text-only reference's body (the quote, the idea), or a Story holding it.
  text: v.optional(v.string()),
  storyId: v.optional(v.id("stories")),
  // The saved representations, in source order (carousel members first). They
  // stay in the collections they were saved to; registering never moves them.
  assetIds: v.array(v.id("assets")),
  expectedCount: v.optional(v.number()),
  preservation: inspirationPreservationValidator,
  // Subject categories: shot, location, story, art, idea, design, tool, ...
  categories: v.array(v.string()),
  // Observed source collections (e.g. an Instagram Saved collection), as provenance and a routing hint.
  sourceCollections: v.array(v.string()),
  // Why it was saved, when Michael said so; agents never invent it.
  savedBecause: v.optional(v.string()),
  capturedAt: v.optional(v.number()),
  review: inspirationSourceReviewValidator,
  reviewedAt: v.optional(v.number()),
  // Michael's latest "what I like about this" note, denormalized from the
  // event log so every reader of the source sees it first.
  ownerNote: v.optional(v.string()),
  ownerNoteAt: v.optional(v.number()),
  // Bumped by every change; owner actions pass the revision they saw.
  revision: v.number(),
  adaptationCount: v.number(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const inspirationAdaptationFields = {
  ownerUserId: v.string(),
  sourceId: v.id("inspirationSources"),
  ingestKey: v.string(),
  // The project (a world root) the adaptation is for; absent = general/library.
  targetWorldId: v.optional(v.id("folders")),
  // Plain words for the target: "Dear Annete · Film".
  targetLabel: v.string(),
  targetStyle: v.optional(v.string()),
  // One line: what idea from the source this transfers, and for what.
  intendedUse: v.string(),
  routing: inspirationRoutingValidator,
  routingReason: v.optional(v.string()),
  status: inspirationAdaptationStatusValidator,
  // 0 until the first version is posted.
  currentVersion: v.number(),
  approvedVersion: v.optional(v.number()),
  // The one active promotion: which output went to which shelf, and exactly
  // what it added, so undo takes back only that.
  promotion: v.optional(v.object({
    version: v.number(),
    outputKey: v.string(),
    assetId: v.id("assets"),
    folderId: v.id("folders"),
    // The membership row this promotion inserted (absent if it was already there).
    linkId: v.optional(v.id("assetFolders")),
    createdAsset: v.boolean(),
    at: v.number(),
  })),
  // The open redo / change-request task, if any.
  redoTaskId: v.optional(v.id("tasks")),
  blockedReason: v.optional(v.string()),
  // Status before a drop, restored on recover.
  statusBeforeDrop: v.optional(inspirationAdaptationStatusValidator),
  revision: v.number(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const inspirationOutputValidator = v.object({
  // Stable within the version: "o1", "o2" ...
  key: v.string(),
  kind: v.union(v.literal("image"), v.literal("video")),
  r2Key: v.string(),
  thumbR2Key: v.optional(v.string()),
  contentType: v.string(),
  contentHash: v.string(),
  size: v.number(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  thumbWidth: v.optional(v.number()),
  thumbHeight: v.optional(v.number()),
  label: v.optional(v.string()),
});

export const inspirationVersionFields = {
  ownerUserId: v.string(),
  adaptationId: v.id("inspirationAdaptations"),
  number: v.number(),
  outputs: v.array(inspirationOutputValidator),
  // A text deliverable (premise, beat treatment, workflow note), markdown.
  text: v.optional(v.string()),
  prompt: v.optional(v.string()),
  // Names of the references passed (sheets, plates, moodboards).
  references: v.array(v.string()),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  // Charged cost when known; costExact false = an estimate.
  costUsd: v.optional(v.number()),
  costExact: v.optional(v.boolean()),
  costNote: v.optional(v.string()),
  // What the agent changed and why (agent view).
  notes: v.optional(v.string()),
  // The version this one answers, and the redo request it answers.
  basedOnVersion: v.optional(v.number()),
  redoEventId: v.optional(v.id("inspirationEvents")),
  // Arrived after Michael dropped the adaptation: kept privately, never current.
  orphan: v.boolean(),
  ingestKey: v.string(),
  createdBy: v.string(),
  createdAt: v.number(),
};

export const inspirationEventActionValidator = v.union(
  v.literal("note"), v.literal("keep"), v.literal("unkeep"), v.literal("drop"), v.literal("recover"),
  v.literal("approve"), v.literal("redo"), v.literal("promote"), v.literal("unpromote"),
);

export const inspirationEventFields = {
  ownerUserId: v.string(),
  // Client idempotency key; the same key applies once.
  eventKey: v.string(),
  sourceId: v.id("inspirationSources"),
  adaptationId: v.optional(v.id("inspirationAdaptations")),
  // The output version the event is about (adaptation events).
  version: v.optional(v.number()),
  action: inspirationEventActionValidator,
  body: v.optional(v.string()),
  author: v.string(),
  taskId: v.optional(v.id("tasks")),
  commentId: v.optional(v.id("assetComments")),
  createdAt: v.number(),
};

/* ── Dispatch safety (convex/inspirationDispatch.ts) ─────────────────────
 * One owner-level dispatcher lease with a fencing token, a priced job
 * ledger and Michael's standing allowance. Paid generation for an
 * adaptation reserves a job here before it calls any provider. With no row,
 * or paused, nothing can be reserved: automatic generation is off until
 * Michael sets an allowance and resumes it in the gallery. */

export const inspirationDispatchFields = {
  ownerUserId: v.string(),
  // Paused = no reservation succeeds. Default when no row exists.
  paused: v.boolean(),
  pausedReason: v.optional(v.string()),
  // Michael's standing allowance: total per cycle, cap per job, expiry and
  // the providers it covers (empty = any). Absent cap = no allowance.
  cycleCapUsd: v.optional(v.number()),
  perJobCapUsd: v.optional(v.number()),
  allowanceExpiresAt: v.optional(v.number()),
  providers: v.array(v.string()),
  // Fixed-length cycles from an anchor (48 h of real time, DST-proof).
  cycleHours: v.number(),
  cycleAnchor: v.number(),
  // The one dispatcher. fence increases on every new claim; a write carrying
  // an older fence, or another holder's nonce, is refused.
  holder: v.optional(v.string()),
  holderNonce: v.optional(v.string()),
  leaseUntil: v.optional(v.number()),
  fence: v.number(),
  revision: v.number(),
  updatedAt: v.number(),
};

export const inspirationJobStatusValidator = v.union(
  // Reserved before any provider call; budget held.
  v.literal("reserved"),
  // The provider (or CLI) accepted it; providerHandle recorded; budget held.
  v.literal("accepted"),
  // Finished and charged (settledUsd); counts toward its cycle.
  v.literal("settled"),
  // Acceptance or charge unknown (crash, timeout, dispatcher replaced).
  // Budget stays held across cycles; never resubmitted automatically.
  v.literal("unknown_outcome"),
  // Never submitted or confirmed not charged; budget returned.
  v.literal("released"),
);

export const inspirationJobFields = {
  ownerUserId: v.string(),
  adaptationId: v.id("inspirationAdaptations"),
  sourceId: v.id("inspirationSources"),
  // The submission intent key: reserving again under it returns this job.
  ingestKey: v.string(),
  status: inspirationJobStatusValidator,
  fence: v.number(),
  worker: v.string(),
  provider: v.string(),
  model: v.string(),
  estimateUsd: v.number(),
  settledUsd: v.optional(v.number()),
  costExact: v.optional(v.boolean()),
  providerHandle: v.optional(v.string()),
  versionId: v.optional(v.id("inspirationVersions")),
  // Start of the cycle the reservation belongs to.
  cycleStart: v.number(),
  note: v.optional(v.string()),
  resolvedBy: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/* ── Private originals (convex/inspirationPrivate.ts) ────────────────────
 * Personal material (family photos, faces, voice, exact places) is kept
 * in Convex file storage, never in the public R2 bucket, and is served only
 * through the authenticated /api/inspiration/media/<id> route. The storage
 * URL is never handed to a client. */

export const inspirationPrivateMediaFields = {
  ownerUserId: v.string(),
  storageId: v.id("_storage"),
  // The source it belongs to; absent while it waits to be registered.
  sourceId: v.optional(v.id("inspirationSources")),
  ingestKey: v.string(),
  kind: v.union(v.literal("image"), v.literal("video"), v.literal("audio")),
  contentType: v.string(),
  size: v.number(),
  // Hex SHA-256 of the stored bytes, from storage's own record.
  sha256: v.string(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  label: v.optional(v.string()),
  // Which outside processors may see these bytes. "none" until Michael
  // clears a processor on the source page: preserve and private analysis
  // only. "cleared" = clearedProcessors names the ones he allowed.
  externalProcessing: v.union(v.literal("none"), v.literal("cleared")),
  clearedProcessors: v.optional(v.array(v.object({ name: v.string(), clearedAt: v.number() }))),
  // The intake event (inspirationCaptures) these bytes arrived with.
  captureId: v.optional(v.id("inspirationCaptures")),
  // What the file's first bytes say it is (lib/file-signature.ts), checked
  // against the declared type before the row is written.
  signature: v.optional(v.string()),
  // Display copy and thumbnail: re-encoded WebP with no EXIF, GPS, maker
  // notes or ICC, served through the same gated route (?variant=display|thumb).
  // derivatives: pending = being cut; ready; original_only = this format has
  // no clean copy (video, voice, HEIC the encoder cannot read); failed.
  derivatives: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("original_only"), v.literal("failed"))),
  derivativesNote: v.optional(v.string()),
  displayStorageId: v.optional(v.id("_storage")),
  displayWidth: v.optional(v.number()),
  displayHeight: v.optional(v.number()),
  thumbStorageId: v.optional(v.id("_storage")),
  thumbWidth: v.optional(v.number()),
  thumbHeight: v.optional(v.number()),
  createdBy: v.string(),
  createdAt: v.number(),
};

/** Proof a private original was deleted by Michael: what it was, never the bytes. */
export const inspirationPrivateDeletionFields = {
  ownerUserId: v.string(),
  mediaId: v.string(),
  sourceId: v.optional(v.id("inspirationSources")),
  sha256: v.string(),
  size: v.number(),
  contentType: v.string(),
  by: v.string(),
  deletedAt: v.number(),
};

/* ── Captures (P0.4 provenance) ──────────────────────────────────────────
 * One row per intake event and representation. Bytes may be shared (the
 * same picture saved from two platforms dedupes to one asset), but every
 * capture keeps its own context: where it came from, who made it, which
 * chat delivered it, and what we actually hold. A screenshot and the full
 * file fetched later are two rows; a Telegram message edit is a new
 * revision under the same key, never a new source. */

export const inspirationCaptureViaValidator = v.object({
  // How it reached the gallery.
  channel: v.union(v.literal("telegram"), v.literal("share_sheet"), v.literal("browser"), v.literal("agent"), v.literal("import")),
  // Telegram: the verified numeric sender, the chat it arrived in and its
  // type, the message id and the bot that received it. Only Michael's own
  // private chat with the bot is accepted (convex/inspiration.ts).
  chatType: v.optional(v.union(v.literal("private"), v.literal("group"), v.literal("supergroup"), v.literal("channel"))),
  chatId: v.optional(v.string()),
  senderId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  bot: v.optional(v.string()),
  // A forwarded post: whose it was originally (data, never identity).
  forwardedFrom: v.optional(v.string()),
});

export const inspirationCaptureFields = {
  ownerUserId: v.string(),
  sourceId: v.id("inspirationSources"),
  // The intake identity: "telegram:dm:<messageId>", "instagram:<shortcode>", ...
  captureKey: v.string(),
  // Message edits are revisions of one capture (1, 2, ...).
  captureRevision: v.number(),
  // What this capture holds (a screenshot is not the post).
  representation: inspirationPreservationValidator,
  platform: inspirationPlatformValidator,
  via: v.optional(inspirationCaptureViaValidator),
  sourceUrl: v.optional(v.string()),
  creator: v.optional(v.string()),
  creatorUrl: v.optional(v.string()),
  caption: v.optional(v.string()),
  text: v.optional(v.string()),
  sourceCollections: v.array(v.string()),
  assetIds: v.array(v.id("assets")),
  // The bytes' hashes at capture time (shared blobs stay traceable).
  contentHashes: v.array(v.string()),
  privateMediaIds: v.array(v.id("inspirationPrivateMedia")),
  capturedAt: v.optional(v.number()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/** Asset-level provenance: every other place the same bytes were saved from. */
export const assetCaptureFields = {
  ownerUserId: v.string(),
  assetId: v.id("assets"),
  sourceUrl: v.optional(v.string()),
  ingestKey: v.optional(v.string()),
  ingestSource: v.optional(v.string()),
  // Which dedupe sent this save to the existing asset.
  matchedBy: v.union(v.literal("contentHash"), v.literal("ingestKey")),
  createdAt: v.number(),
};
