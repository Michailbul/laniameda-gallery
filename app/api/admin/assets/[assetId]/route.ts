import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";
import {
  getCurationAdminSecret,
  isCurationAdmin,
} from "@/lib/server/admin";

const adminUpdateAssetMutation = makeFunctionReference<"mutation">(
  "assets:adminUpdateAsset",
);

const assetKinds = new Set(["image", "video"]);
const generationTypes = new Set([
  "image_gen",
  "video_gen",
  "ui_design",
  "workflow",
  "other",
]);
const assetRoles = new Set([
  "generated_output",
  "reference",
  "inspiration_capture",
  "workflow_asset",
  "cinema_frame",
  "other",
]);
const ingestSources = new Set(["api", "agent", "telegram", "manual", "import"]);

const readOptionalText = (
  body: Record<string, unknown>,
  key: string,
): string | null | undefined => {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string or null.`);
  }
  return value;
};

const readOptionalEnum = (
  body: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
): string | null | undefined => {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${key} has an unsupported value.`);
  }
  return value;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const user = await requireAppUser();
    if (!isCurationAdmin(user.ownerUserId)) {
      return NextResponse.json(
        { error: "Only gallery admins can edit assets." },
        { status: 403 },
      );
    }

    const adminSecret = getCurationAdminSecret();
    if (!adminSecret) {
      return NextResponse.json(
        { error: "Asset editing is disabled: CURATION_ADMIN_SECRET is not configured." },
        { status: 503 },
      );
    }

    const { assetId } = await context.params;
    if (!assetId?.trim()) {
      return NextResponse.json({ error: "assetId is required." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "JSON object body is required." }, { status: 400 });
    }

    const tagNames = "tagNames" in body
      ? Array.isArray(body.tagNames)
        ? body.tagNames.map((tag) => {
            if (typeof tag !== "string") {
              throw new Error("tagNames must contain only strings.");
            }
            return tag;
          })
        : (() => {
            throw new Error("tagNames must be an array.");
          })()
      : undefined;
    const folderId =
      "folderId" in body
        ? body.folderId === null || body.folderId === ""
          ? null
          : typeof body.folderId === "string"
            ? (body.folderId as Id<"folders">)
            : (() => {
                throw new Error("folderId must be a string or null.");
              })()
        : undefined;

    const client = getServerConvexClient();
    const result = await client.mutation(adminUpdateAssetMutation, {
      assetId: assetId as Id<"assets">,
      actorUserId: user.ownerUserId,
      adminSecret,
      description: readOptionalText(body, "description"),
      promptText: readOptionalText(body, "promptText"),
      tagNames,
      folderId,
      sourceUrl: readOptionalText(body, "sourceUrl"),
      fileName: readOptionalText(body, "fileName"),
      contentType: readOptionalText(body, "contentType"),
      kind: readOptionalEnum(body, "kind", assetKinds) ?? undefined,
      modelName: readOptionalText(body, "modelName"),
      pillar: readOptionalText(body, "pillar"),
      generationType: readOptionalEnum(body, "generationType", generationTypes),
      assetRole: readOptionalEnum(body, "assetRole", assetRoles),
      ingestSource: readOptionalEnum(body, "ingestSource", ingestSources),
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to edit asset.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
