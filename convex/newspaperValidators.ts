import { v } from "convex/values";

// The morning newspaper (convex/newspaper.ts): one edition per Prague date,
// compiled from the gallery's own tables. Shared by the schema and the
// functions' return validators.

export const newspaperStatusValidator = v.union(v.literal("compiled"), v.literal("written"));

export const newspaperFields = {
  ownerUserId: v.string(),
  // YYYY-MM-DD in Europe/Prague: the edition's key, one per owner per day.
  date: v.string(),
  compiledAt: v.number(),
  // The window the facts cover.
  since: v.number(),
  until: v.number(),
  // JSON of lib/newspaper-contract.ts newspaperFactsSchema. Pure facts with
  // ids and paths; the prose is the agent's.
  facts: v.string(),
  // Headline counts, denormalized for the date list and the notification.
  done: v.number(),
  needsYou: v.number(),
  saved: v.number(),
  // The agent's editorial, markdown. Absent until write_newspaper.
  prose: v.optional(v.string()),
  writtenAt: v.optional(v.number()),
  writtenBy: v.optional(v.string()),
  status: newspaperStatusValidator,
  // Who or what compiled the edition: "cron" or an actor label.
  compiledBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const newspaperDocValidator = v.object({
  _id: v.id("newspapers"),
  _creationTime: v.number(),
  ...newspaperFields,
});

/** A row of the date picker: no facts, no prose. */
export const newspaperSummaryValidator = v.object({
  _id: v.id("newspapers"),
  date: v.string(),
  compiledAt: v.number(),
  status: newspaperStatusValidator,
  done: v.number(),
  needsYou: v.number(),
  saved: v.number(),
});
