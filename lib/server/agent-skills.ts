import { makeFunctionReference } from "convex/server";
import type { AgentAuthContext } from "@/lib/server/agent-auth";
import type { CreateSkillInput } from "@/lib/skill-contract";
import { validateAgentFolders } from "@/lib/server/agent-ingest";
import { resolveUploadedMedia } from "@/lib/server/agent-uploads";
import { getServerConvexClient } from "@/lib/server/convex";

const createSkillAction = makeFunctionReference<"action">("workflows:createSkillFromApi");
const getSkillQuery = makeFunctionReference<"query">("workflows:getWorkflow");

export const createSkillForAgent = async (agent: AgentAuthContext, input: CreateSkillInput) => {
  const client = getServerConvexClient(agent.ownerUserId);
  const folderIds = [...new Set(input.folderIds ?? [])];
  await validateAgentFolders(client, agent.ownerUserId, folderIds);
  // Resolve all upload tickets before creating any Skill or step rows.
  const steps = await Promise.all((input.steps ?? []).map(async (step) => ({
    ...step,
    allowPromptOnly: !step.media?.length,
    media: await Promise.all((step.media ?? []).map(async (item) => {
      const { uploadId, posterUploadId, fileBase64, fileName, contentType, ...rest } = item;
      if (uploadId) return {
        ...rest,
        ...await resolveUploadedMedia({ ownerUserId: agent.ownerUserId, uploadId, posterUploadId, fileName, contentType }),
      };
      return { ...rest, ...(fileBase64 ? { file: { base64: fileBase64, fileName, contentType } } : {}) };
    })),
  })));
  const result = await client.action(createSkillAction, { ...input, folderIds, steps, ownerUserId: agent.ownerUserId });
  const skill = await client.query(getSkillQuery, { ownerUserId: agent.ownerUserId, id: result.workflowId });
  if (!skill) throw new Error("The Skill save could not be verified. Retry with the same ingestKey.");
  return { ok: true, id: `skill:${result.workflowId}`, created: result.created, skill };
};
