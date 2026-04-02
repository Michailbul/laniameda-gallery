import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import type { Id } from "@/convex/_generated/dataModel";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

const listDesignSaveTemplatesQuery = makeFunctionReference<"query">(
  "designSaveTemplates:listDesignSaveTemplates",
);
const upsertDesignSaveTemplateMutation = makeFunctionReference<"mutation">(
  "designSaveTemplates:upsertDesignSaveTemplate",
);
const deleteDesignSaveTemplateMutation = makeFunctionReference<"mutation">(
  "designSaveTemplates:deleteDesignSaveTemplate",
);

const readJson = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const normalizeTagNames = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tags = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
};

export async function GET() {
  try {
    const user = await requireAppUser();
    const client = getServerConvexClient();
    const templates = await client.query(listDesignSaveTemplatesQuery, {
      ownerUserId: user.ownerUserId,
    });

    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load design save templates.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAppUser();
    const payload = await readJson(request);
    if (!payload) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const key = typeof payload.key === "string" ? payload.key.trim() : "";
    const label = typeof payload.label === "string" ? payload.label.trim() : "";
    if (!key || !label) {
      return NextResponse.json({ error: "key and label are required." }, { status: 400 });
    }

    const client = getServerConvexClient();
    const result = await client.mutation(upsertDesignSaveTemplateMutation, {
      ownerUserId: user.ownerUserId,
      key,
      label,
      description:
        typeof payload.description === "string" ? payload.description.trim() || undefined : undefined,
      defaults: {
        captureKind:
          typeof payload.captureKind === "string" ? payload.captureKind : undefined,
        saveIntent:
          typeof payload.saveIntent === "string" ? payload.saveIntent : undefined,
        inspirationType:
          typeof payload.inspirationType === "string" ? payload.inspirationType : undefined,
        platform: typeof payload.platform === "string" ? payload.platform : undefined,
        workflowType:
          typeof payload.workflowType === "string" ? payload.workflowType : undefined,
        tagNames: normalizeTagNames(payload.tagNames),
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to save design save template.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAppUser();
    const payload = await readJson(request);
    const id = typeof payload?.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Template id is required." }, { status: 400 });
    }

    const client = getServerConvexClient();
    const deletedId = await client.mutation(deleteDesignSaveTemplateMutation, {
      ownerUserId: user.ownerUserId,
      id: id as Id<"designSaveTemplates">,
    });

    return NextResponse.json({ ok: true, deletedId });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to delete design save template.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
