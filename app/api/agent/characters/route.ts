import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import {
  bareId, bareOptionalId, characterCostumeSchema, characterCreateSchema, characterLinkSchema, characterListSchema,
  characterRefOf, characterRefSchema, characterRemoveCostumeSchema, characterUnlinkSchema, characterUpdateSchema, worldRefOf,
} from "@/lib/character-contract";

const actions = ["list", "get", "forAsset", "create", "update", "costume", "removeCostume", "link", "unlink", "delete"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  list: "gallery:read", get: "gallery:read", forAsset: "gallery:read",
  create: "gallery:write", update: "gallery:write", costume: "gallery:write", removeCostume: "gallery:write",
  link: "gallery:write", unlink: "gallery:write", delete: "gallery:delete",
};

type AssetId = Id<"assets">;
const asset = <T extends string | null | undefined>(value: T) => bareOptionalId(value) as T extends string ? AssetId : T;

export async function POST(request: Request) {
  try {
    const { action: rawAction, ...body } = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(rawAction);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    // `world` is a key, name or root id, resolved like open_world does; an
    // unknown one fails with the resolver's message, never an opaque error.
    const resolveWorld = async (ref: string) =>
      (await client.query(api.worlds.resolveWorldRef, { ownerUserId, world: bareId(ref) })).worldId;

    if (action === "list") {
      const { world, worldFolderId: alias, ...input } = characterListSchema.parse(body);
      const worldRef = worldRefOf({ world, worldFolderId: alias });
      const rows = await client.query(api.characters.listCharacters, {
        ownerUserId, ...input, worldFolderId: worldRef ? await resolveWorld(worldRef) : undefined,
      });
      return NextResponse.json({ count: rows.length, characters: rows });
    }
    if (action === "get") {
      const input = characterRefSchema.parse(body);
      return NextResponse.json(await client.query(api.characters.getCharacter, { ownerUserId, character: characterRefOf(input) }));
    }
    if (action === "forAsset") {
      const assetId = bareId(z.string().min(1).parse(body.assetId)) as AssetId;
      return NextResponse.json({ characters: await client.query(api.characters.listCharactersForAsset, { ownerUserId, assetId }) });
    }
    if (action === "create") {
      const { world, worldFolderId: alias, ...input } = characterCreateSchema.parse(body);
      const result = await client.mutation(api.characters.createCharacter, {
        ownerUserId, ...input, worldFolderId: await resolveWorld(worldRefOf({ world, worldFolderId: alias })!),
        sheetAssetId: asset(input.sheetAssetId), faceAssetId: asset(input.faceAssetId),
      });
      return NextResponse.json({ ok: true, ...result, ...await client.query(api.characters.getCharacter, { ownerUserId, character: result.code }) });
    }
    if (action === "update") {
      const input = characterUpdateSchema.parse(body);
      const result = await client.mutation(api.characters.updateCharacter, {
        ownerUserId, ...input, character: input.character,
        sheetAssetId: asset(input.sheetAssetId), faceAssetId: asset(input.faceAssetId),
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "costume") {
      const input = characterCostumeSchema.parse(body);
      const result = await client.mutation(api.characters.saveCostume, {
        ownerUserId, ...input, character: input.character,
        sheetAssetId: asset(input.sheetAssetId), faceAssetId: asset(input.faceAssetId),
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "removeCostume") {
      const input = characterRemoveCostumeSchema.parse(body);
      return NextResponse.json({ ok: true, ...await client.mutation(api.characters.removeCostume, { ownerUserId, character: input.character, code: input.code }) });
    }
    if (action === "link") {
      const input = characterLinkSchema.parse(body);
      const result = await client.mutation(api.characters.linkAssets, {
        ownerUserId, character: input.character,
        links: input.links.map((link) => ({ ...link, assetId: bareId(link.assetId) as AssetId })),
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "unlink") {
      const input = characterUnlinkSchema.parse(body);
      const result = await client.mutation(api.characters.unlinkAssets, {
        ownerUserId, character: input.character, assetIds: input.assetIds.map((id) => bareId(id) as AssetId),
      });
      return NextResponse.json({ ok: true, ...result });
    }
    const input = characterRefSchema.parse(body);
    return NextResponse.json({ ok: true, ...await client.mutation(api.characters.deleteCharacter, { ownerUserId, character: characterRefOf(input) }) });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Character request failed.") }, { status: 400 });
  }
}
