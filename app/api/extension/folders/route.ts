import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

// Collections are stored as `folders` rows. The extension surfaces them as
// "Collections" but the backend contract stays `folders` for parity with the
// gallery app, the agent API, and the MCP server.
const listFoldersQuery = makeFunctionReference<"query">("folders:listFolders");
const createFolderMutation = makeFunctionReference<"mutation">(
  "folders:createFolder",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

// Return only what the extension picker needs — not ownerUserId/timestamps.
type FolderRow = { _id: string; name?: string; description?: string };
const toFolderDto = (folders: unknown) =>
  (Array.isArray(folders) ? (folders as FolderRow[]) : []).map((folder) => ({
    _id: folder._id,
    name: folder.name ?? "",
    description: folder.description,
  }));

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const client = getServerConvexClient();
    const folders = await client.query(listFoldersQuery, { ownerUserId });
    return corsJson({ ok: true, folders: toFolderDto(folders) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load collections.";
    return corsJson({ error: message }, 400);
  }
}

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const payload = (await request.json().catch(() => null)) as
      | { name?: unknown; description?: unknown }
      | null;
    const name =
      payload && typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) {
      return corsJson({ error: "name is required." }, 400);
    }
    if (name.length > MAX_NAME_LENGTH) {
      return corsJson({ error: `name must be ${MAX_NAME_LENGTH} characters or fewer.` }, 400);
    }
    const description =
      payload && typeof payload.description === "string"
        ? payload.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
        : undefined;

    const client = getServerConvexClient();
    const result = await client.mutation(createFolderMutation, {
      ownerUserId,
      name,
      description: description || undefined,
    });
    const folders = await client.query(listFoldersQuery, { ownerUserId });
    return corsJson({ ok: true, result, folders: toFolderDto(folders) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create collection.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
