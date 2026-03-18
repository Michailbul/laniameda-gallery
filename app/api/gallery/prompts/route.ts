import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

const parseLimit = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const isMissingPromptOnlyQueryError = (error: unknown) => {
  return (
    error instanceof Error &&
    error.message.includes(
      "Could not find public function for 'prompts:listPromptOnlyGalleryPrompts'",
    )
  );
};

const fetchPromptOnlyPromptsFallback = async (
  ownerUserId: string,
  limit: number | undefined,
) => {
  const client = getServerConvexClient();
  const resolvedLimit = Math.min(limit ?? 200, 200);
  const [prompts, designInspirations] = await Promise.all([
    client.query(api.prompts.listPrompts, {
      ownerUserId,
      limit: resolvedLimit,
    }),
    client.query(api.designInspirations.listDesignInspirations, {
      ownerUserId,
      limit: 200,
    }),
  ]);

  const linkedDesignPromptIds = new Set(
    designInspirations
      .map((designInspiration) => designInspiration.promptId)
      .filter((promptId): promptId is Id<"prompts"> => Boolean(promptId)),
  );

  const assetChecks = await Promise.all(
    prompts.map(async (prompt) => {
      const linkedAssets = await client.query(api.assets.listAssets, {
        ownerUserId,
        promptId: prompt._id,
        limit: 1,
      });
      return {
        promptId: prompt._id,
        hasLinkedAsset: linkedAssets.length > 0,
      };
    }),
  );

  const linkedAssetPromptIds = new Set(
    assetChecks
      .filter((result) => result.hasLinkedAsset)
      .map((result) => result.promptId),
  );

  return prompts
    .filter((prompt) => {
      return (
        !linkedAssetPromptIds.has(prompt._id) &&
        !linkedDesignPromptIds.has(prompt._id)
      );
    })
    .map((prompt) => ({
      ...prompt,
      linkedAssetCount: 0,
      linkedDesignInspirationCount: 0,
    }));
};

export async function GET(request: Request) {
  try {
    const user = await requireAppUser();
    const client = getServerConvexClient();
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    let prompts;

    try {
      prompts = await client.query(api.prompts.listPromptOnlyGalleryPrompts, {
        ownerUserId: user.ownerUserId,
        limit,
      });
    } catch (error) {
      if (!isMissingPromptOnlyQueryError(error)) {
        throw error;
      }
      prompts = await fetchPromptOnlyPromptsFallback(user.ownerUserId, limit);
    }

    return NextResponse.json({ prompts });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load prompts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
