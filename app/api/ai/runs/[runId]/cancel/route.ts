import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { convexRuns } from "@/lib/ai/convex-runs";
import { cancelRunExecution } from "@/lib/ai/runtime-state";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const authUser = await requireAuth();

    const { runId } = await params;
    const body = (await request.json().catch(() => null)) as { reason?: string } | null;
    const reason = typeof body?.reason === "string" ? body.reason : "Canceled by user.";

    const canceledLocal = cancelRunExecution(runId);
    const result = await convexRuns.cancelRun({
      runId,
      userId: authUser.id,
      reason,
    });

    return NextResponse.json({
      ok: true,
      runId,
      status: result.status,
      canceledLocal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
