import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import { api } from "@/convex/_generated/api";
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

// A profile Midjourney no longer has ("CAS COAST (deleted in MJ)") never
// reaches the dock (Michael, 11 Nov 2026).
const isDeletedProfile = (profile: ProfileRow) => /\bdeleted\b/i.test(profile.name ?? "");

// The world's Midjourney taste profiles: one chip each in the dock, toggled
// in the prompt's profile flag beside the moodboard code. The role is the
// world's own use of the profile, shown on hover.
const toProfileDtos = (rows: unknown, worldKey: string) =>
  (Array.isArray(rows) ? (rows as ProfileRow[]) : [])
    .filter((profile) => typeof profile.code === "string" && profile.code.trim() && profile.status !== "retired" && !isDeletedProfile(profile))
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
    // Every other live profile, with the worlds that use it, for the dock's
    // "Other worlds" panel: a profile of another world in one click.
    let otherProfiles: Array<ReturnType<typeof toProfileDtos>[number] & { worlds: string[] }> = [];
    try {
      const here = new Set(profiles.map((profile) => profile.code));
      const all = (await client.query(listProfilesQuery, { ownerUserId, includeRetired: false })) as ProfileRow[];
      otherProfiles = toProfileDtos(all, resolved.key)
        .filter((profile) => !here.has(profile.code))
        .map((profile) => {
          const row = all.find((entry) => String(entry.id) === profile.id);
          const worlds = [...new Set((row?.uses ?? []).map((use) => use.world).filter((key): key is string => Boolean(key)))];
          return { ...profile, worlds };
        });
    } catch {
      otherProfiles = [];
    }
    // Gallery style presets a dock chip can set: codes and settings only (an
    // sref or an opening sentence runs from the queue). Dock-made ones are
    // already in the dock.
    let galleryPresets: Array<{ id: string; name: string; codes: string[]; params: string; gallery: true }> = [];
    try {
      const presets = await client.query(api.promptGrid.listPresets, { ownerUserId, world: resolved.key });
      galleryPresets = presets
        .filter((preset) => preset.source !== "dock" && preset.srefs.length === 0 && !preset.sentence && preset.status !== "archived")
        .slice(0, 16)
        .map((preset) => ({
          id: `gal:${preset.id}`, name: preset.name, gallery: true as const,
          codes: [...preset.moodboards, ...preset.profiles].map((row) => row.code),
          params: (preset.parameters ?? "").replace(/--(?:ar|aspect|seed)\s+\S+/g, "").replace(/\s+/g, " ").trim(),
        }));
    } catch {
      galleryPresets = [];
    }
    return corsJson({
      ok: true,
      worlds: worldList,
      world: toWorldDto(resolved),
      moodboards: toMoodboardDtos(rows),
      profiles,
      otherProfiles,
      galleryPresets,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load moodboards.";
    return corsJson({ error: message }, 400);
  }
}

// The dock's own presets, kept as gallery style presets of the world.
export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const body = (await request.json().catch(() => null)) as { action?: string; world?: string; presets?: Array<{ id: string; name: string; codes: string[]; params?: string }> } | null;
    if (body?.action !== "syncPresets" || !body.world || !Array.isArray(body.presets)) return corsJson({ error: "Expected {action: syncPresets, world, presets}." }, 400);
    const ownerUserId = resolveExtensionOwnerUserId();
    const presets = body.presets.slice(0, 32).map((preset) => ({
      id: String(preset.id ?? "").slice(0, 80), name: String(preset.name ?? "").slice(0, 100),
      codes: (Array.isArray(preset.codes) ? preset.codes : []).map(String).slice(0, 12), params: preset.params ? String(preset.params).slice(0, 300) : undefined,
    })).filter((preset) => preset.id);
    const result = await getServerConvexClient(ownerUserId).mutation(api.promptGrid.importDockPresets, { ownerUserId, world: body.world, presets });
    return corsJson({ ok: true, ...result });
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Could not save the presets." }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
