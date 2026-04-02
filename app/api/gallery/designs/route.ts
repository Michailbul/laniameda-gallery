import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import type { Id } from "@/convex/_generated/dataModel";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

type CaptureKind = "website" | "image" | "component" | "tutorial";
type SaveIntent = "utility" | "inspiration" | "component" | "tutorial";
type InspirationType =
  | "website"
  | "landing_page"
  | "dashboard"
  | "component"
  | "mobile_app"
  | "motion"
  | "branding"
  | "asset_pack"
  | "other";
type Platform = "web" | "ios" | "android" | "cross_platform" | "other";
type WorkflowType =
  | "component_prompt"
  | "page_prompt"
  | "system_prompt"
  | "asset_recipe"
  | "other";

const listDesignGalleryEntriesQuery = makeFunctionReference<"query">(
  "designInspirations:listDesignGalleryEntries",
);

const VALID_CAPTURE_KINDS = new Set<CaptureKind>([
  "website",
  "image",
  "component",
  "tutorial",
]);
const VALID_SAVE_INTENTS = new Set<SaveIntent>([
  "utility",
  "inspiration",
  "component",
  "tutorial",
]);
const VALID_INSPIRATION_TYPES = new Set<InspirationType>([
  "website",
  "landing_page",
  "dashboard",
  "component",
  "mobile_app",
  "motion",
  "branding",
  "asset_pack",
  "other",
]);
const VALID_PLATFORMS = new Set<Platform>([
  "web",
  "ios",
  "android",
  "cross_platform",
  "other",
]);
const VALID_WORKFLOW_TYPES = new Set<WorkflowType>([
  "component_prompt",
  "page_prompt",
  "system_prompt",
  "asset_recipe",
  "other",
]);

const parseLimit = (value: string | null) => {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseDate = (value: string | null) => {
  if (!value) {
    return undefined;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const parseTagIds = (params: URLSearchParams) => {
  const values = params
    .getAll("tagIds")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? (values as Id<"tags">[]) : undefined;
};

const parseEnum = <T extends string>(value: string | null, allowed: Set<T>) => {
  if (!value) {
    return undefined;
  }
  return allowed.has(value as T) ? (value as T) : undefined;
};

export async function GET(request: Request) {
  try {
    const user = await requireAppUser();
    const url = new URL(request.url);
    const params = url.searchParams;
    const client = getServerConvexClient();

    const designs = await client.query(listDesignGalleryEntriesQuery, {
      ownerUserId: user.ownerUserId,
      tagIds: parseTagIds(params),
      matchAllTags: params.get("matchAllTags") === "true",
      folderId: (params.get("folderId")?.trim() || undefined) as Id<"folders"> | undefined,
      inspirationType: parseEnum(params.get("inspirationType"), VALID_INSPIRATION_TYPES),
      platform: parseEnum(params.get("platform"), VALID_PLATFORMS),
      workflowType: parseEnum(params.get("workflowType"), VALID_WORKFLOW_TYPES),
      captureKind: parseEnum(params.get("captureKind"), VALID_CAPTURE_KINDS),
      saveIntent: parseEnum(params.get("saveIntent"), VALID_SAVE_INTENTS),
      sourceDomain: params.get("sourceDomain")?.trim() || undefined,
      search: params.get("search")?.trim() || undefined,
      dateFrom: parseDate(params.get("dateFrom")),
      dateTo: parseDate(params.get("dateTo")),
      requireAsset: true,
      limit: parseLimit(params.get("limit")),
    });

    return NextResponse.json({ designs });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load design gallery entries.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
