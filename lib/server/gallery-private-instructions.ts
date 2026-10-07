import { makeFunctionReference } from "convex/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireAgentAuth } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";

const getResource = makeFunctionReference<"query">("agentInstructions:getResource");
const privatePaths = new Set(["references/worlds.md", "references/maintenance.md"]);

// No world names, IDs or creative policy live in server code. Private policy
// documents are owner data and survive deployments from the public repository.
export const galleryInstructionSource = (ownerUserId?: string, request?: Request) => async (path: string): Promise<string> => {
  if (!privatePaths.has(path)) return readFile(join(process.cwd(), "skills/laniameda-gallery", path), "utf8");
  const owner = ownerUserId ?? (request ? (await requireAgentAuth(request, "gallery:read")).ownerUserId : undefined);
  if (!owner) throw new Error("Authenticated instruction owner required.");
  const resource = await getServerConvexClient(owner).query(getResource, { ownerUserId: owner, resourcePath: path });
  if (!resource) throw new Error("Private instruction resource is unavailable.");
  return resource.content as string;
};
