import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { convexRuns } from "@/lib/ai/convex-runs";
import { consumeRateLimit } from "@/lib/ai/rate-limit";
import {
  clearRunAbortController,
  registerRunAbortController,
} from "@/lib/ai/runtime-state";
import { createPromptPackageStream, toCompactUsage } from "@/lib/ai/runtime";
import {
  getDefaultRuntime,
  getDefaultTextModel,
  isAiRuntime,
  type AiRuntime,
} from "@/lib/ai/models";
import {
  buildRunIdempotencyKey,
  isRunIntent,
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

const parseRuntime = (value: unknown): AiRuntime | null => {
  if (typeof value !== "string") {
    return null;
  }
  return isAiRuntime(value) ? value : null;
};

const runtimeFromRequest = (value: unknown) => {
  return parseRuntime(value) || getDefaultRuntime();
};

const encoder = new TextEncoder();

const ndjson = (payload: unknown) => encoder.encode(`${JSON.stringify(payload)}\n`);

export async function POST(request: Request) {
  let runId: string | undefined;
  try {
    const authUser = await requireAuth();

    const rateLimit = consumeRateLimit({
      key: `ai:runs:stream:${authUser.id}`,
      limit: 12,
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
          intent?: string;
          source?: string;
          referenceAssetId?: string;
          userInput?: unknown;
          runtime?: string;
        }
      | null;

    if (!body || typeof body.intent !== "string" || !isRunIntent(body.intent)) {
      return NextResponse.json({ error: "Valid intent is required." }, { status: 400 });
    }

    if (!body.referenceAssetId || typeof body.referenceAssetId !== "string") {
      return NextResponse.json({ error: "referenceAssetId is required." }, { status: 400 });
    }

    const source = body.source && isRunSource(body.source) ? body.source : "dashboard";
    const runtime = runtimeFromRequest(body.runtime);

    const inputFingerprint = createInputFingerprint({
      referenceAssetId: body.referenceAssetId,
      userInput: body.userInput,
      runtime,
    });
    const idempotencyKey = buildRunIdempotencyKey({
      userId: authUser.id,
      intent: body.intent,
      source,
      inputFingerprint,
    });

    const provider = "gateway" as const;
    const model = getDefaultTextModel();

    const createdRun = await convexRuns.createRun({
      userId: authUser.id,
      intent: body.intent,
      source,
      input: {
        referenceAssetId: body.referenceAssetId,
        userInput: body.userInput,
      },
      idempotencyKey,
      runtime,
      provider,
      model,
      mode: "prompt_package",
    });

    const createdRunId = createdRun.runId;
    runId = createdRunId;

    const abortController = new AbortController();
    registerRunAbortController(createdRunId, abortController);

    await convexRuns.setRunRunning({
      runId: createdRunId,
      workerId: "next-ai-sdk",
      sandboxId: undefined,
      sandboxLabel: undefined,
    });
    await convexRuns.appendRunEvent({
      runId: createdRunId,
      type: "system",
      payload: {
        phase: "ai_sdk_started",
        runtime,
      },
    });

    const streamResult = createPromptPackageStream({
      intent: body.intent,
      referenceAssetId: body.referenceAssetId,
      userInput: body.userInput,
      signal: abortController.signal,
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ndjson({ type: "run_start", runId: createdRunId }));

        void (async () => {
          try {
            for await (const partial of streamResult.partialOutputStream) {
              controller.enqueue(ndjson({ type: "partial", runId: createdRunId, partial }));
            }

            const [output, usage] = await Promise.all([streamResult.output, streamResult.totalUsage]);
            const compactUsage = toCompactUsage(usage);

            await convexRuns.completeRun({
              runId: createdRunId,
              workerId: "next-ai-sdk",
              usage: compactUsage,
              artifacts: [
                {
                  kind: "prompt_package",
                  mimeType: "application/json",
                  textContent: JSON.stringify(output, null, 2),
                  metadata: {
                    runtime,
                    provider,
                    model,
                    referenceAssetId: body.referenceAssetId,
                    intent: body.intent,
                  },
                },
              ],
            });

            await convexRuns.appendRunEvent({
              runId: createdRunId,
              type: "system",
              payload: {
                phase: "ai_sdk_completed",
              },
            });

            controller.enqueue(
              ndjson({
                type: "done",
                runId: createdRunId,
                output,
                usage: compactUsage,
              }),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "AI SDK run failed.";
            if (abortController.signal.aborted) {
              await convexRuns.cancelRun({
                runId: createdRunId,
                userId: authUser.id,
                reason: message,
              });
              controller.enqueue(ndjson({ type: "canceled", runId: createdRunId, message }));
            } else {
              await convexRuns.failRun({
                runId: createdRunId,
                workerId: "next-ai-sdk",
                error: message,
              });
              controller.enqueue(ndjson({ type: "error", runId: createdRunId, error: message }));
            }
          } finally {
            clearRunAbortController(createdRunId);
            controller.close();
          }
        })();
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-run-id": createdRunId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (runId) {
      await convexRuns
        .failRun({
          runId,
          workerId: "next-ai-sdk",
          error: message,
        })
        .catch(() => {
          // no-op
        });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
