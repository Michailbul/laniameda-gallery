import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

const listWorldsQuery = makeFunctionReference<"query">("worlds:listWorlds");
const resolveWorldRefQuery = makeFunctionReference<"query">(
  "worlds:resolveWorldRef",
);
const listMoodboardsQuery = makeFunctionReference<"query">(
  "moodboards:listMoodboards",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

type WorldRow = { worldId: string; key: string; name: string };
type BoardRow = {
  _id: string;
  name?: string;
  folderName?: string;
  styleTag?: string;
  status?: string;
  mjCode?: string;
  itemCount?: number;
  updatedAt?: number;
  previewItems?: Array<{ thumbUrl?: string; url?: string; kind?: string }>;
};

const toWorldDto = (world: WorldRow) => ({
  worldId: String(world.worldId),
  key: world.key,
  name: world.name,
});

const shortNameOf = (name: string) => {
  const index = name.lastIndexOf("·");
  return index === -1 ? name : name.slice(index + 1).trim();
};

const toMoodboardDtos = (rows: unknown) =>
  (Array.isArray(rows) ? (rows as BoardRow[]) : [])
    .filter((board) => typeof board.mjCode === "string" && board.mjCode.trim())
    .map((board) => {
      const name = board.name ?? "";
      const code = String(board.mjCode).trim();
      const previews = (board.previewItems ?? [])
        .filter((item) => item.kind !== "video")
        .map((item) => ({
          thumbUrl: item.thumbUrl || item.url || "",
          url: item.url || "",
        }))
        .filter((item) => item.thumbUrl);
      return {
        id: String(board._id),
        name,
        shortName: shortNameOf(name),
        collection: board.folderName ?? "",
        styleTag: board.styleTag ?? null,
        status: board.status ?? null,
        mjCode: code,
        flag: `-p ${code}`,
        thumbUrl: previews[0]?.thumbUrl ?? null,
        previews,
        itemCount: board.itemCount ?? 0,
        updatedAt: board.updatedAt ?? 0,
      };
    });

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const client = getServerConvexClient(ownerUserId);
    const worldParam = new URL(request.url).searchParams.get("world")?.trim();

    const worlds = (await client.query(listWorldsQuery, {
      ownerUserId,
    })) as WorldRow[];
    const worldList = (Array.isArray(worlds) ? worlds : []).map(toWorldDto);

    if (!worldParam) {
      return corsJson({
        ok: true,
        worlds: worldList,
        world: null,
        moodboards: [],
      });
    }

    const resolved = (await client.query(resolveWorldRefQuery, {
      ownerUserId,
      world: worldParam,
    })) as WorldRow;
    const rows = await client.query(listMoodboardsQuery, {
      ownerUserId,
      folderId: resolved.worldId,
      includeChildren: true,
      previewLimit: 6,
    });
    return corsJson({
      ok: true,
      worlds: worldList,
      world: toWorldDto(resolved),
      moodboards: toMoodboardDtos(rows),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load moodboards.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
