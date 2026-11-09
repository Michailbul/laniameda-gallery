import { v } from "convex/values";

// Director review: a project (CASSANDRA) that an outside director opens at a
// public address (mishabuloichyk.com/cassandra), signs in with Google, and
// likes, dislikes and comments on frames. Frames sit in folders (locations,
// characters, later scenes) and in styles (world styles; the director sees
// only a label and a cover). Each round is a version: items belong to one
// version, so earlier rounds stay exactly as they were shown. Feedback is
// keyed by asset, so a like on a frame carries into the next round.

export const reviewSectionValidator = v.union(
  v.literal("locations"),
  v.literal("characters"),
  v.literal("scenes"),
);

export const reviewVerdictValidator = v.union(v.literal("like"), v.literal("dislike"));

export const reviewVersionStatusValidator = v.union(v.literal("draft"), v.literal("published"));

export const reviewRoleValidator = v.union(
  v.literal("owner"),
  v.literal("director"),
  v.literal("viewer"),
);

export const reviewerValidator = v.object({
  email: v.string(),
  name: v.optional(v.string()),
  pictureUrl: v.optional(v.string()),
  // director = gives feedback; viewer = looks only.
  role: v.union(v.literal("director"), v.literal("viewer")),
  // What they are on the film, shown next to their avatar ("Director",
  // "Producer · Fantasy Studios").
  title: v.optional(v.string()),
  addedAt: v.number(),
  lastSeenAt: v.optional(v.number()),
  // Read up to here in the notification bell.
  notificationsSeenAt: v.optional(v.number()),
  // Other Google accounts of the same person: they sign in as this reviewer.
  // The first unknown account that picks this person's name at sign-in
  // becomes one (Alejandro's invited address is iCloud, not Google).
  aliases: v.optional(v.array(v.string())),
  // Signed in with Google under their own invited address: their name can no
  // longer be claimed by another account.
  googleAt: v.optional(v.number()),
  // The owner's "Reset sign-in": visits before it no longer lock the name.
  signInResetAt: v.optional(v.number()),
  // Short personal sign-in link: <public address>/i/<inviteCode>
  // ("alejandro-k7m2xq9p"). Stays the same until the owner makes a new one.
  inviteCode: v.optional(v.string()),
});

// A style shown in the review, in carousel order. The style's recipe
// (moodboards, profiles, prompts) stays on the world style; `label` is the
// plain name the director reads ("Night storybook").
export const reviewStyleEntryValidator = v.object({
  styleId: v.id("worldStyles"),
  label: v.optional(v.string()),
  hidden: v.optional(v.boolean()),
});

export const reviewProjectFields = {
  ownerUserId: v.string(),
  slug: v.string(),
  title: v.string(),
  subtitle: v.optional(v.string()),
  worldFolderId: v.optional(v.id("folders")),
  reviewers: v.array(reviewerValidator),
  // Google accounts that act as the owner on the public address.
  ownerEmails: v.array(v.string()),
  styles: v.array(reviewStyleEntryValidator),
  // What the director sees by default (the latest published round, or an
  // earlier one after a rollback).
  currentVersionId: v.optional(v.id("reviewVersions")),
  // The round being prepared; promotes land here.
  draftVersionId: v.optional(v.id("reviewVersions")),
  publicUrl: v.optional(v.string()),
  // The owner's "read up to here" mark for director feedback.
  feedbackSeenAt: v.optional(v.number()),
  // The owner's "read up to here" mark in the notification bell.
  notificationsSeenAt: v.optional(v.number()),
  // Anyone with the link may look as a guest, without signing in.
  // Unset = open; false = invited people only.
  openSignIn: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const reviewFolderFields = {
  ownerUserId: v.string(),
  projectId: v.id("reviewProjects"),
  section: reviewSectionValidator,
  // Group label in the left nav ("San Pancho", "Mexico City", "Main cast").
  area: v.optional(v.string()),
  name: v.string(),
  slug: v.string(),
  // One plain line for the director.
  note: v.optional(v.string()),
  // Script scene numbers this place or character appears in.
  scenes: v.optional(v.array(v.number())),
  // Icon shown before the name in the left nav: a lucide icon name in
  // kebab case ("tree-palm", "school", "sailboat").
  icon: v.optional(v.string()),
  order: v.number(),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const reviewVersionFields = {
  ownerUserId: v.string(),
  projectId: v.id("reviewProjects"),
  number: v.number(),
  label: v.string(),
  status: reviewVersionStatusValidator,
  title: v.optional(v.string()),
  note: v.optional(v.string()),
  basedOnVersionId: v.optional(v.id("reviewVersions")),
  createdAt: v.number(),
  publishedAt: v.optional(v.number()),
};

export const reviewItemFields = {
  ownerUserId: v.string(),
  projectId: v.id("reviewProjects"),
  versionId: v.id("reviewVersions"),
  assetId: v.id("assets"),
  folderId: v.id("reviewFolders"),
  styleId: v.optional(v.id("worldStyles")),
  order: v.number(),
  // Owner caption shown to the director under the frame.
  note: v.optional(v.string()),
  // Earlier takes this frame replaced, oldest first (iterations).
  previousAssetIds: v.optional(v.array(v.id("assets"))),
  // Held · only you (art-director scope, 9 Nov 2026): in the draft for Michael
  // and agents only. Publishing leaves it out and carries it into the next
  // draft; one click releases it into the round.
  held: v.optional(v.boolean()),
  addedAt: v.number(),
};

export const reviewFeedbackFields = {
  projectId: v.id("reviewProjects"),
  assetId: v.id("assets"),
  reviewerEmail: v.string(),
  role: reviewRoleValidator,
  verdict: reviewVerdictValidator,
  // The round it was given in.
  versionId: v.optional(v.id("reviewVersions")),
  createdAt: v.number(),
  updatedAt: v.number(),
};

// A like or dislike on a whole style ("I like this look in general"), one per
// reviewer per style; keyed like reviewFeedback (email, or "owner").
export const reviewStyleFeedbackFields = {
  projectId: v.id("reviewProjects"),
  styleId: v.id("worldStyles"),
  reviewerEmail: v.string(),
  role: reviewRoleValidator,
  verdict: reviewVerdictValidator,
  // The round it was given in.
  versionId: v.optional(v.id("reviewVersions")),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const reviewCommentFields = {
  projectId: v.id("reviewProjects"),
  assetId: v.id("assets"),
  versionId: v.optional(v.id("reviewVersions")),
  authorEmail: v.optional(v.string()),
  authorName: v.string(),
  authorRole: v.union(v.literal("director"), v.literal("viewer"), v.literal("owner"), v.literal("agent")),
  body: v.string(),
  // Set when one comment was written on several frames at once.
  batchId: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};
