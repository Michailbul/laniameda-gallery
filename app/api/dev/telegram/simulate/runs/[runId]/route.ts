import { NextResponse } from "next/server";
import { convexRuns } from "@/lib/ai/convex-runs";
import { isDevTelegramSimRequestAllowed } from "@/lib/dev-telegram-sim";
import { createLogger, createRequestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const logger = createLogger({ service: "next-api-dev-telegram-sim" });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const requestId = createRequestId();
  if (!isDevTelegramSimRequestAllowed(request)) {
    return NextResponse.json(
      {
        error: "Dev Telegram simulator is disabled or not allowed for this host.",
        requestId,
      },
      { status: 403 },
    );
  }

  const { runId } = await params;
  const result = await convexRuns.getRun({ runId });
  if (!result) {
    return NextResponse.json({ error: "Run not found.", requestId }, { status: 404 });
  }

  logger.info(
    {
      requestId,
      runId,
      source: result.run.source,
      status: result.run.status,
      phase: "dev_telegram_sim_run_read",
    },
    "dev_telegram_sim_run_read",
  );

  return NextResponse.json({
    ok: true,
    requestId,
    run: result.run,
    events: result.events,
    artifacts: result.artifacts,
  });
}
