import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { buildIngestKey, fileToBase64, parseTagNames } from "@/lib/ingest";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");

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

export async function POST(request: Request) {
  try {
    const session = await withAuth({ ensureSignedIn: true });
    if (!session.user?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

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

    const finalIngestKey = buildIngestKey({
      ingestKey,
      url,
      promptText,
      fileName: file?.name,
    });

    const payload: Record<string, unknown> = {
      ownerUserId: session.user.id,
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

    const client = getConvexClient();
    const result = await client.action(ingestAction, payload);

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
