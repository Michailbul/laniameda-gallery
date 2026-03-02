import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { requireAuth } from "@/lib/server-auth";
import { buildIngestKey, fileToBase64, parseTagNames } from "@/lib/ingest";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");
const recordIngestFailureMutation = makeFunctionReference<"mutation">(
  "ingest_failures:recordIngestFailure",
);
const resolveIngestFailureMutation = makeFunctionReference<"mutation">(
  "ingest_failures:resolveIngestFailure",
);

const getConvexClient = () => {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("CONVEX_URL is not configured.");
  }
  return new ConvexHttpClient(url);
};

const readJson = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const sanitizeFailurePayload = (payload: Record<string, unknown>) => {
  const file =
    payload.file && typeof payload.file === "object"
      ? (payload.file as Record<string, unknown>)
      : undefined;

  return {
    ownerUserId: payload.ownerUserId,
    promptText: payload.promptText,
    url: payload.url,
    folderId: payload.folderId,
    ingestKey: payload.ingestKey,
    promptIngestKey: payload.promptIngestKey,
    tagNames: payload.tagNames,
    modelName: payload.modelName,
    pillar: payload.pillar,
    generationType: payload.generationType,
    promptType: payload.promptType,
    domain: payload.domain,
    file: file
      ? {
          fileName: file.fileName,
          contentType: file.contentType,
          base64Size: typeof file.base64 === "string" ? file.base64.length : undefined,
        }
      : undefined,
  };
};

export async function POST(request: Request) {
  let ownerUserId: string | undefined;
  let finalIngestKey: string | undefined;
  let failurePayload: Record<string, unknown> | undefined;

  try {
    const authUser = await requireAuth();
    ownerUserId = authUser.id;

    const contentType = request.headers.get("content-type") || "";
    let promptText: string | undefined;
    let url: string | undefined;
    let folderId: string | undefined;
    let ingestKey: string | undefined;
    let promptIngestKey: string | undefined;
    let tagNames: string[] = [];
    let file: File | null = null;
    let modelName: string | undefined;
    let pillar: string | undefined;
    let generationType: string | undefined;
    let promptType: string | undefined;
    let domain: string | undefined;

    if (contentType.includes("application/json")) {
      const data = await readJson(request);
      if (!data) {
        return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
      }
      promptText = typeof data.promptText === "string" ? data.promptText : undefined;
      url = typeof data.url === "string" ? data.url : undefined;
      folderId = typeof data.folderId === "string" ? data.folderId : undefined;
      ingestKey = typeof data.ingestKey === "string" ? data.ingestKey : undefined;
      promptIngestKey =
        typeof data.promptIngestKey === "string" ? data.promptIngestKey : undefined;
      if (Array.isArray(data.tagNames)) {
        tagNames = parseTagNames(data.tagNames as string[]);
      }
      modelName = typeof data.modelName === "string" ? data.modelName : undefined;
      pillar = typeof data.pillar === "string" ? data.pillar : undefined;
      generationType = typeof data.generationType === "string" ? data.generationType : undefined;
      promptType = typeof data.promptType === "string" ? data.promptType : undefined;
      domain = typeof data.domain === "string" ? data.domain : undefined;
    } else {
      const form = await request.formData();
      const promptValue = form.get("prompt");
      const urlValue = form.get("url");
      const folderValue = form.get("folderId");
      const ingestValue = form.get("ingestKey");
      const promptIngestValue = form.get("promptIngestKey");
      const tagValue = form.getAll("tags");
      const fileValue = form.get("file");

      promptText = typeof promptValue === "string" ? promptValue : undefined;
      url = typeof urlValue === "string" ? urlValue : undefined;
      folderId = typeof folderValue === "string" ? folderValue : undefined;
      ingestKey = typeof ingestValue === "string" ? ingestValue : undefined;
      promptIngestKey =
        typeof promptIngestValue === "string" ? promptIngestValue : undefined;

      if (tagValue.length > 0) {
        const tagStrings = tagValue.filter(
          (entry): entry is string => typeof entry === "string",
        );
        tagNames = parseTagNames(tagStrings);
      }

      if (fileValue instanceof File) {
        file = fileValue;
      }

      const modelNameValue = form.get("modelName");
      const pillarValue = form.get("pillar");
      const generationTypeValue = form.get("generationType");
      const promptTypeValue = form.get("promptType");
      const domainValue = form.get("domain");
      modelName = typeof modelNameValue === "string" ? modelNameValue : undefined;
      pillar = typeof pillarValue === "string" ? pillarValue : undefined;
      generationType = typeof generationTypeValue === "string" ? generationTypeValue : undefined;
      promptType = typeof promptTypeValue === "string" ? promptTypeValue : undefined;
      domain = typeof domainValue === "string" ? domainValue : undefined;
    }

    finalIngestKey = buildIngestKey({
      ingestKey,
      url,
      promptText,
      fileName: file?.name,
    });

    const payload: Record<string, unknown> = {
      ownerUserId,
      promptText,
      url,
      folderId,
      ingestKey: finalIngestKey,
      promptIngestKey,
      tagNames,
      modelName: modelName || undefined,
      pillar: pillar || undefined,
      generationType: generationType || undefined,
      promptType: promptType || undefined,
      domain: domain || undefined,
    };

    if (file) {
      payload.file = {
        base64: await fileToBase64(file),
        fileName: file.name,
        contentType: file.type || undefined,
      };
    }

    failurePayload = sanitizeFailurePayload(payload);

    const client = getConvexClient();
    const result = await client.action(ingestAction, payload);

    if (ownerUserId && finalIngestKey) {
      void client.mutation(resolveIngestFailureMutation, {
        ownerUserId,
        ingestKey: finalIngestKey,
      });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const errorName = error instanceof Error ? error.name : undefined;
    let failureId: string | undefined;

    if (ownerUserId) {
      try {
        const client = getConvexClient();
        const failureRecord = await client.mutation(recordIngestFailureMutation, {
          source: "api",
          ownerUserId,
          ingestKey: finalIngestKey,
          payload: failurePayload,
          errorMessage: message,
          errorName,
        });
        failureId = failureRecord.failureId;
      } catch {
        // Best-effort fallback cache write.
      }
    }

    return NextResponse.json({ error: message, failureId }, { status: 400 });
  }
}
