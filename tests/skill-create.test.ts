import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { createSkillInputSchema } from "../lib/skill-contract";
import { addSkillToCollection, createSkillFromApi, createWorkflow, deleteWorkflow, finalizeWorkflow, getSkillCreation, ingestWorkflowFromApi, linkPromptToWorkflow, skillCreationFingerprint } from "../convex/workflows";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const harness = () => {
  const { ctx: dbCtx, db } = createMockConvexMutationCtx();
  const prompts = new Map<string, string>();
  const assets = new Map<string, string>();
  const state = { failMediaKey: undefined as string | undefined, ingestCalls: [] as Record<string, unknown>[] };
  const ctx = {
    ...dbCtx,
    auth: { getUserIdentity: async () => ({ subject: "owner" }) },
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      if (name === "workflows:getSkillCreation") return callAsOwner(getSkillCreation)(ctx, args);
      if (name === "folders:validateOwnedFolders") return [];
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      switch (getFunctionName(ref)) {
        case "workflows:createWorkflow": return callAsOwner(createWorkflow)(ctx, args);
        case "workflows:linkPromptToWorkflow": return callAsOwner(linkPromptToWorkflow)(ctx, args);
        case "workflows:finalizeWorkflow": return callAsOwner(finalizeWorkflow)(ctx, args);
        case "workflows:addSkillToCollection": return callAsOwner(addSkillToCollection)(ctx, args);
        default: throw new Error(`Unexpected mutation ${getFunctionName(ref)}`);
      }
    },
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>): Promise<unknown> => {
      if (getFunctionName(ref) === "workflows:ingestWorkflowFromApi") return callAsOwner(ingestWorkflowFromApi)(ctx, args);
      if (getFunctionName(ref) !== "ingest:ingestFromApi") throw new Error("Unexpected action");
      state.ingestCalls.push(args);
      if (args.ingestKey === state.failMediaKey) { state.failMediaKey = undefined; throw new Error("Remote media unavailable"); }
      const promptKey = String(args.promptIngestKey);
      let promptId = prompts.get(promptKey);
      if (!promptId) {
        promptId = await db.insert("prompts", { ownerUserId: "owner", text: args.promptText, tagIds: [], ingestKey: promptKey, createdAt: Date.now() });
        prompts.set(promptKey, promptId);
      }
      let assetId = assets.get(String(args.ingestKey));
      if (args.url && !assetId) {
        assetId = await db.insert("assets", { ownerUserId: "owner", kind: "image", promptId, tagIds: [], sourceUrl: args.sourceUrl, agentDescription: args.agentDescription, assetRole: args.assetRole, createdAt: Date.now() });
        assets.set(String(args.ingestKey), assetId);
      }
      return { promptId, assetId };
    },
  };
  return { ctx, db, state };
};

describe("create Skill contract", () => {
  test("supports a real markdown-only Skill and rejects owner/publication injection", () => {
    expect(createSkillInputSchema.parse({ ingestKey: "notes:v1", title: "Notes", body: "# Reusable notes" }).steps).toBeUndefined();
    expect(createSkillInputSchema.safeParse({ ingestKey: "empty", title: "Empty" }).success).toBe(false);
    expect(createSkillInputSchema.safeParse({ ingestKey: "notes", title: "Notes", body: "Content", ownerUserId: "other" }).success).toBe(false);
    expect(createSkillInputSchema.safeParse({ ingestKey: "notes", title: "Notes", body: "Content", isPublic: true }).success).toBe(false);
    expect(createSkillInputSchema.safeParse({ ingestKey: "two", title: "Two", steps: [{ promptText: "Prompt", media: [{ url: "https://example.com/a.jpg", uploadId: "ticket" }] }] }).success).toBe(false);
  });

  test("fingerprints ignore object key order but detect changed content", async () => {
    expect(await skillCreationFingerprint({ a: 1, nested: { c: 3, b: 2 } })).toBe(await skillCreationFingerprint({ nested: { b: 2, c: 3 }, a: 1 }));
    expect(await skillCreationFingerprint({ body: "A" })).not.toBe(await skillCreationFingerprint({ body: "B" }));
  });

  test("completed retry creates nothing and preserves later Skill edits", async () => {
    const { ctx, db, state } = harness();
    const args = { ownerUserId: "owner", ingestKey: "markdown:v1", title: "Reusable notes", body: "Original", steps: [] };
    const first = await callAsOwner(createSkillFromApi)(ctx, args);
    await db.patch(first.workflowId, { body: "Later user edit" });
    expect(await callAsOwner(createSkillFromApi)(ctx, args)).toEqual({ ...first, created: false });
    expect((await db.get(first.workflowId))?.body).toBe("Later user edit");
    expect(db.getTableDocs("workflows")).toHaveLength(1);
    expect(db.getTableDocs("assets")).toHaveLength(0);
    expect(state.ingestCalls).toHaveLength(0);
    await expect(callAsOwner(createSkillFromApi)(ctx, { ...args, body: "Changed same key" })).rejects.toThrow("another Skill creation");
  });

  test("interrupted multipart ingest reports its saved ID and safely resumes exact step/media keys", async () => {
    const { ctx, db, state } = harness();
    const args = { ownerUserId: "owner", ingestKey: "media:v1", title: "Two renders", steps: [{ promptText: "A reusable prompt", modelName: "Model", media: [{ url: "https://example.com/a.jpg", sourceUrl: "https://example.com/source", agentDescription: "Original source render" }, { url: "https://example.com/b.jpg" }] }] };
    state.failMediaKey = "media:v1:step0:m1";
    try { await callAsOwner(createSkillFromApi)(ctx, args); throw new Error("Expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(ConvexError); expect((error as ConvexError<unknown>).data).toMatchObject({ partial: true, failedStep: "steps", skillId: expect.stringContaining("skill:") }); }
    expect(db.getTableDocs("workflows")).toHaveLength(1);
    expect(db.getTableDocs("assets")).toHaveLength(1);
    const resumed = await callAsOwner(createSkillFromApi)(ctx, args);
    expect(resumed.created).toBe(false); expect(resumed.stepCount).toBe(1);
    expect(db.getTableDocs("workflows")).toHaveLength(1);
    expect(db.getTableDocs("prompts")).toHaveLength(1);
    expect(db.getTableDocs("assets")).toHaveLength(2);
    expect((await db.get(resumed.workflowId))?.creationComplete).toBe(true);
    expect(state.ingestCalls[0]).toMatchObject({ sourceUrl: "https://example.com/source", agentDescription: "Original source render", assetRole: "workflow_asset" });
    const before = state.ingestCalls.length;
    await callAsOwner(createSkillFromApi)(ctx, args);
    expect(state.ingestCalls).toHaveLength(before);
  });

  test("creation never accepts an unsigned owner argument during legacy rollout", async () => {
    const { ctx } = harness();
    const previous = process.env.LEGACY_OWNER_ARG_AUTH;
    process.env.LEGACY_OWNER_ARG_AUTH = "true";
    try { await expect(callAsOwner(createSkillFromApi)({ ...ctx, auth: { getUserIdentity: async () => null } }, { ownerUserId: "owner", ingestKey: "key", title: "Title", body: "Content", steps: [] })).rejects.toThrow("Not authenticated"); }
    finally { if (previous === undefined) delete process.env.LEGACY_OWNER_ARG_AUTH; else process.env.LEGACY_OWNER_ARG_AUTH = previous; }
  });

  test("deleting a Skill is owner scoped, retry safe, and preserves prompts and media", async () => {
    const { ctx, db } = harness();
    const saved = await callAsOwner(createSkillFromApi)(ctx, { ownerUserId: "owner", ingestKey: "delete:v1", title: "Recipe", steps: [{ promptText: "Prompt", media: [{ url: "https://example.com/a.jpg" }] }] });
    await expect(callAsOwner(deleteWorkflow)({ ...ctx, auth: { getUserIdentity: async () => ({ subject: "intruder" }) } }, { ownerUserId: "intruder", id: saved.workflowId })).rejects.toThrow("this user");
    await callAsOwner(deleteWorkflow)(ctx, { ownerUserId: "owner", id: saved.workflowId });
    await callAsOwner(deleteWorkflow)(ctx, { ownerUserId: "owner", id: saved.workflowId });
    expect(db.getTableDocs("workflows")).toHaveLength(0);
    expect(db.getTableDocs("prompts")).toHaveLength(1);
    expect(db.getTableDocs("assets")).toHaveLength(1);
    expect(db.getTableDocs("prompts")[0].workflowId).toBeUndefined();
    expect(db.getTableDocs("assets")[0].assetRole).toBeUndefined();
  });
});
