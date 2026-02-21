import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { convexRuns } from "@/lib/ai/convex-runs";
import { cancelRunInWorker } from "@/lib/ai/worker-dispatch";
import { cancelRunExecution } from "@/lib/ai/runtime-state";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const session = await withAuth({ ensureSignedIn: true });
    if (!session.user?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { runId } = await params;
    const body = (await request.json().catch(() => null)) as { reason?: string } | null;
    const reason = typeof body?.reason === "string" ? body.reason : "Canceled by user.";

    const canceledLocal = cancelRunExecution(runId);
    const result = await convexRuns.cancelRun({
      runId,
      userId: session.user.id,
      reason,
    });

    await cancelRunInWorker({
      runId,
      requestedBy: session.user.id,
    }).catch(() => {
      // best effort
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
