import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { convexRuns } from "@/lib/ai/convex-runs";
import { consumeRateLimit } from "@/lib/ai/rate-limit";
import {
  cancelRunExecution,
  clearRunAbortController,
  registerRunAbortController,
} from "@/lib/ai/runtime-state";
import { generateImageFromPrompt } from "@/lib/ai/runtime";
import { resolveImageModelAlias } from "@/lib/ai/models";
import {
  buildRunIdempotencyKey,
  RUN_SOURCES,
  type RunSource,
} from "@/lib/run-contract";

const isRunSource = (value: string): value is RunSource => {
  return RUN_SOURCES.includes(value as RunSource);
};

const createInputFingerprint = (input: unknown) => {
  if (input === undefined || input === null) {
    return "none";
  }
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
};

export async function POST(request: Request) {
  let runId: string | undefined;
  try {
    const authUser = await requireAuth();

    const rateLimit = consumeRateLimit({
      key: `ai:images:generate:${authUser.id}`,
      limit: 6,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded.",
          resetAt: rateLimit.resetAt,
        },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | {
          prompt?: string;
          modelAlias?: string;
          referenceAssetIds?: string[];
          source?: string;
        }
      | null;

    if (!body?.prompt || typeof body.prompt !== "string") {
      return NextResponse.json({ error: "prompt is required." }, { status: 400 });
    }

    const modelSelection = resolveImageModelAlias(body.modelAlias);
    if (!modelSelection.ok) {
      return NextResponse.json(
        {
          error: modelSelection.error,
          allowedAliases: modelSelection.allowedAliases,
        },
        { status: 400 },
      );
    }

    const source = body.source && isRunSource(body.source) ? body.source : "dashboard";

    const inputFingerprint = createInputFingerprint({
      prompt: body.prompt,
      modelAlias: modelSelection.alias,
      referenceAssetIds: body.referenceAssetIds ?? [],
    });

    const idempotencyKey = buildRunIdempotencyKey({
      userId: authUser.id,
      intent: "execute",
      source,
      inputFingerprint,
    });

    const createdRun = await convexRuns.createRun({
      userId: authUser.id,
      intent: "execute",
      source,
      input: {
        prompt: body.prompt,
        modelAlias: modelSelection.alias,
        referenceAssetIds: body.referenceAssetIds ?? [],
      },
      idempotencyKey,
      runtime: "ai_sdk",
      provider: modelSelection.provider,
      model: modelSelection.modelId,
      mode: "image_generate",
    });

    const createdRunId = createdRun.runId;
    runId = createdRunId;

    await convexRuns.setRunRunning({
      runId: createdRunId,
      workerId: "next-ai-sdk",
    });

    const controller = new AbortController();
    registerRunAbortController(createdRunId, controller);

    const generated = await generateImageFromPrompt({
      modelId: modelSelection.modelId,
      prompt: body.prompt,
      signal: controller.signal,
    });

    await convexRuns.completeRun({
      runId: createdRunId,
      workerId: "next-ai-sdk",
      usage: generated.usage,
      artifacts: [
        {
          kind: "image",
          mimeType: generated.mediaType,
          textContent: generated.dataUrl,
          metadata: {
            modelAlias: modelSelection.alias,
            model: modelSelection.modelId,
            provider: modelSelection.provider,
            imagesGenerated: generated.imagesCount,
          },
        },
      ],
    });

    clearRunAbortController(createdRunId);

    return NextResponse.json({
      ok: true,
      runId: createdRunId,
      status: "completed",
      imageDataUrl: generated.dataUrl,
      mediaType: generated.mediaType,
      usage: generated.usage,
      modelAlias: modelSelection.alias,
      model: modelSelection.modelId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (runId) {
      cancelRunExecution(runId);
      await convexRuns
        .failRun({
          runId,
          workerId: "next-ai-sdk",
          error: message,
        })
        .catch(() => {
          // no-op
        });
      clearRunAbortController(runId);
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
