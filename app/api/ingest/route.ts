import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAuth } from "@/lib/server-auth";
import { buildIngestKey, fileToBase64, parseTagNames } from "@/lib/ingest";
import { getServerConvexClient } from "@/lib/server/convex";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");
const recordIngestFailureMutation = makeFunctionReference<"mutation">(
  "ingest_failures:recordIngestFailure",
);
const resolveIngestFailureMutation = makeFunctionReference<"mutation">(
  "ingest_failures:resolveIngestFailure",
);

const readJson = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const parseOptionalJsonField = <T = unknown>(value: FormDataEntryValue | null) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
};

const parseOptionalBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
};

const sanitizeFailurePayload = (payload: Record<string, unknown>) => {
  const file =
    payload.file && typeof payload.file === "object"
      ? (payload.file as Record<string, unknown>)
      : undefined;

  return {
    ownerUserId: payload.ownerUserId,
    promptText: payload.promptText,
    allowPromptOnly: payload.allowPromptOnly,
    url: payload.url,
    folderId: payload.folderId,
    ingestKey: payload.ingestKey,
    promptIngestKey: payload.promptIngestKey,
    tagNames: payload.tagNames,
    modelName: payload.modelName,
    pillar: payload.pillar,
    generationType: payload.generationType,
    promptType: payload.promptType,
    workflowType: payload.workflowType,
    modelProvider: payload.modelProvider,
    promptSections: payload.promptSections,
    promptProfile: payload.promptProfile,
    typedTags: payload.typedTags,
    assetRole: payload.assetRole,
    ingestSource: payload.ingestSource,
    designInspiration: payload.designInspiration,
    upstreamInputs: payload.upstreamInputs,
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

const resolvePromptText = ({
  promptText,
  promptSections,
}: {
  promptText?: string;
  promptSections?: Record<string, unknown>;
}) => {
  const trimmedPromptText = promptText?.trim();
  if (trimmedPromptText) {
    return trimmedPromptText;
  }

  const finalPrompt = promptSections?.finalPrompt;
  if (typeof finalPrompt !== "string") {
    return undefined;
  }

  const trimmedFinalPrompt = finalPrompt.trim();
  return trimmedFinalPrompt || undefined;
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
    let allowPromptOnly: boolean | undefined;
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
    let workflowType: string | undefined;
    let domain: string | undefined;
    let modelProvider: string | undefined;
    let promptSections: Record<string, unknown> | undefined;
    let promptProfile: Record<string, unknown> | undefined;
    let typedTags: Record<string, unknown>[] | undefined;
    let assetRole: string | undefined;
    let ingestSource: string | undefined;
    let designInspiration: Record<string, unknown> | undefined;
    let upstreamInputs: Record<string, unknown>[] | undefined;

    if (contentType.includes("application/json")) {
      const data = await readJson(request);
      if (!data) {
        return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
      }
      promptText = typeof data.promptText === "string" ? data.promptText : undefined;
      allowPromptOnly = parseOptionalBoolean(data.allowPromptOnly);
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
      workflowType = typeof data.workflowType === "string" ? data.workflowType : undefined;
      domain = typeof data.domain === "string" ? data.domain : undefined;
      modelProvider = typeof data.modelProvider === "string" ? data.modelProvider : undefined;
      promptSections =
        data.promptSections &&
        typeof data.promptSections === "object" &&
        !Array.isArray(data.promptSections)
          ? (data.promptSections as Record<string, unknown>)
          : undefined;
      promptProfile =
        data.promptProfile &&
        typeof data.promptProfile === "object" &&
        !Array.isArray(data.promptProfile)
          ? (data.promptProfile as Record<string, unknown>)
          : undefined;
      typedTags = Array.isArray(data.typedTags)
        ? (data.typedTags as Record<string, unknown>[])
        : undefined;
      assetRole = typeof data.assetRole === "string" ? data.assetRole : undefined;
      ingestSource = typeof data.ingestSource === "string" ? data.ingestSource : undefined;
      designInspiration =
        data.designInspiration &&
        typeof data.designInspiration === "object" &&
        !Array.isArray(data.designInspiration)
          ? (data.designInspiration as Record<string, unknown>)
          : undefined;
      upstreamInputs = Array.isArray(data.upstreamInputs)
        ? (data.upstreamInputs as Record<string, unknown>[])
        : undefined;
    } else {
      const form = await request.formData();
      const promptValue = form.get("prompt");
      const urlValue = form.get("url");
      const allowPromptOnlyValue = form.get("allowPromptOnly");
      const folderValue = form.get("folderId");
      const ingestValue = form.get("ingestKey");
      const promptIngestValue = form.get("promptIngestKey");
      const tagValue = form.getAll("tags");
      const fileValue = form.get("file");

      promptText = typeof promptValue === "string" ? promptValue : undefined;
      allowPromptOnly = parseOptionalBoolean(allowPromptOnlyValue);
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
      const workflowTypeValue = form.get("workflowType");
      const domainValue = form.get("domain");
      const modelProviderValue = form.get("modelProvider");
      const promptSectionsValue = form.get("promptSections");
      const promptProfileValue = form.get("promptProfile");
      const typedTagsValue = form.get("typedTags");
      const assetRoleValue = form.get("assetRole");
      const ingestSourceValue = form.get("ingestSource");
      const designInspirationValue = form.get("designInspiration");
      const upstreamInputsValue = form.get("upstreamInputs");
      modelName = typeof modelNameValue === "string" ? modelNameValue : undefined;
      pillar = typeof pillarValue === "string" ? pillarValue : undefined;
      generationType = typeof generationTypeValue === "string" ? generationTypeValue : undefined;
      promptType = typeof promptTypeValue === "string" ? promptTypeValue : undefined;
      workflowType = typeof workflowTypeValue === "string" ? workflowTypeValue : undefined;
      domain = typeof domainValue === "string" ? domainValue : undefined;
      modelProvider = typeof modelProviderValue === "string" ? modelProviderValue : undefined;
      promptSections = parseOptionalJsonField<Record<string, unknown>>(promptSectionsValue);
      promptProfile = parseOptionalJsonField<Record<string, unknown>>(promptProfileValue);
      typedTags = parseOptionalJsonField<Record<string, unknown>[]>(typedTagsValue);
      assetRole = typeof assetRoleValue === "string" ? assetRoleValue : undefined;
      ingestSource = typeof ingestSourceValue === "string" ? ingestSourceValue : undefined;
      designInspiration =
        parseOptionalJsonField<Record<string, unknown>>(designInspirationValue);
      upstreamInputs = parseOptionalJsonField<Record<string, unknown>[]>(
        upstreamInputsValue,
      );
    }

    const resolvedPromptText = resolvePromptText({
      promptText,
      promptSections,
    });
    const hasMediaInput = Boolean(url || file);
    const hasDesignInspirationInput = Boolean(designInspiration);
    const isPromptOnlyIngest =
      Boolean(resolvedPromptText) &&
      !hasMediaInput &&
      !hasDesignInspirationInput;

    if (!resolvedPromptText && !hasMediaInput && !hasDesignInspirationInput) {
      return NextResponse.json(
        { error: "Provide prompt content, URL, file, or design inspiration." },
        { status: 400 },
      );
    }

    if (isPromptOnlyIngest && allowPromptOnly !== true) {
      return NextResponse.json(
        { error: "Prompt-only ingest requires allowPromptOnly=true." },
        { status: 400 },
      );
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
      allowPromptOnly,
      url,
      folderId,
      ingestKey: finalIngestKey,
      promptIngestKey,
      tagNames,
      modelName: modelName || undefined,
      modelProvider: modelProvider || undefined,
      pillar: pillar || undefined,
      generationType: generationType || undefined,
      promptType: promptType || undefined,
      workflowType: workflowType || undefined,
      promptSections,
      promptProfile,
      typedTags,
      assetRole: assetRole || undefined,
      ingestSource: ingestSource || undefined,
      designInspiration,
      upstreamInputs,
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

    const client = getServerConvexClient();
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
        const client = getServerConvexClient();
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
