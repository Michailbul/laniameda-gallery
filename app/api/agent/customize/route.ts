import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";

type AgentScope = "gallery:read" | "gallery:write" | "gallery:delete";

const readJson = async (request: Request) => {
  try {
    const data = await request.json();
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const tagInputArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : undefined;

const tagNameArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

const requiredScopeForAction = (action: string): AgentScope => {
  if (action.startsWith("list")) return "gallery:read";
  if (action === "deleteFolder") return "gallery:delete";
  return "gallery:write";
};

const userTagPayload = (
  ownerUserId: string,
  data: Record<string, unknown>,
) => ({
  ownerUserId,
  name: stringValue(data.name) ?? "",
  label: stringValue(data.label),
  description: stringValue(data.description),
  category: stringValue(data.category) as never,
  source: stringValue(data.source) as never,
  color: stringValue(data.color),
  sortOrder: numberValue(data.sortOrder),
});

export async function POST(request: Request) {
  try {
    const data = await readJson(request);
    if (!data) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const action = stringValue(data.action);
    if (!action) {
      return NextResponse.json({ error: "action is required." }, { status: 400 });
    }

    const agent = await requireAgentAuth(request, requiredScopeForAction(action));
    const client = getServerConvexClient();

    if (action === "listTags") {
      const tags = await client.query(api.userTags.listUserTags, {
        ownerUserId: agent.ownerUserId,
        includeArchived: data.includeArchived === true,
      });
      return NextResponse.json({ tags });
    }

    if (action === "upsertTag") {
      const result = await client.mutation(
        api.userTags.upsertUserTag,
        userTagPayload(agent.ownerUserId, data),
      );
      return NextResponse.json(result);
    }

    if (action === "upsertTags") {
      const inputs =
        tagInputArray(data.tags) ??
        tagNameArray(data.tagNames)?.map((name) => ({ name }));
      if (!inputs || inputs.length === 0) {
        return NextResponse.json(
          { error: "tags or tagNames is required." },
          { status: 400 },
        );
      }

      const tags = [];
      for (const input of inputs) {
        tags.push(
          await client.mutation(api.userTags.upsertUserTag, {
            ...userTagPayload(agent.ownerUserId, {
              ...data,
              ...input,
            }),
          }),
        );
      }
      return NextResponse.json({ tags });
    }

    if (action === "archiveTag") {
      await client.mutation(api.userTags.archiveUserTag, {
        ownerUserId: agent.ownerUserId,
        tagId: stringValue(data.tagId) as Id<"tags"> | undefined,
        name: stringValue(data.name),
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "listFolders") {
      const folders = await client.query(api.folders.listFolders, {
        ownerUserId: agent.ownerUserId,
      });
      return NextResponse.json({ folders });
    }

    if (action === "createFolder") {
      const result = await client.mutation(api.folders.createFolder, {
        ownerUserId: agent.ownerUserId,
        name: stringValue(data.name) ?? "",
        description: stringValue(data.description),
      });
      return NextResponse.json(result);
    }

    if (action === "updateFolder") {
      const result = await client.mutation(api.folders.updateFolder, {
        ownerUserId: agent.ownerUserId,
        folderId: stringValue(data.folderId) as Id<"folders">,
        name: stringValue(data.name) ?? "",
        description: stringValue(data.description),
      });
      return NextResponse.json({ folderId: result });
    }

    if (action === "deleteFolder") {
      const result = await client.mutation(api.folders.deleteFolder, {
        ownerUserId: agent.ownerUserId,
        folderId: stringValue(data.folderId) as Id<"folders">,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
