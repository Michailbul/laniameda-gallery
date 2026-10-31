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
const listProfilesQuery = makeFunctionReference<"query">(
  "mjProfiles:listProfiles",
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
  mjUrl?: string;
  itemCount?: number;
  updatedAt?: number;
  previewItems?: Array<{ thumbUrl?: string; url?: string; kind?: string }>;
};

type ProfileRow = {
  id: string;
  name?: string;
  code?: string;
  status?: string;
  uses?: Array<{ world?: string; role?: string; styleTag?: string }>;
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
        url: board.mjUrl ?? null,
        thumbUrl: previews[0]?.thumbUrl ?? null,
        previews,
        itemCount: board.itemCount ?? 0,
        updatedAt: board.updatedAt ?? 0,
      };
    });

// The world's Midjourney taste profiles: one chip each in the dock, toggled
// in the prompt's profile flag beside the moodboard code. The role is the
// world's own use of the profile, shown on hover.
const toProfileDtos = (rows: unknown, worldKey: string) =>
  (Array.isArray(rows) ? (rows as ProfileRow[]) : [])
    .filter((profile) => typeof profile.code === "string" && profile.code.trim() && profile.status !== "retired")
    .map((profile) => {
      const code = String(profile.code).trim();
      const use = (profile.uses ?? []).find((entry) => entry.world === worldKey) ?? profile.uses?.[0];
      return {
        id: String(profile.id),
        name: profile.name ?? code,
        code,
        flag: `-p ${code}`,
        role: use?.role ?? "",
        styleTag: use?.styleTag ?? null,
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
        profiles: [],
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
    // A profile lookup that fails leaves the moodboards working.
    let profiles: ReturnType<typeof toProfileDtos> = [];
    try {
      profiles = toProfileDtos(
        await client.query(listProfilesQuery, { ownerUserId, world: resolved.key, includeRetired: false }),
        resolved.key,
      );
    } catch {
      profiles = [];
    }
    return corsJson({
      ok: true,
      worlds: worldList,
      world: toWorldDto(resolved),
      moodboards: toMoodboardDtos(rows),
      profiles,
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
