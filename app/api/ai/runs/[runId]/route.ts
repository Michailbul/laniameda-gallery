import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { convexRuns } from "@/lib/ai/convex-runs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const session = await withAuth({ ensureSignedIn: true });
    if (!session.user?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { runId } = await params;
    const result = await convexRuns.getRun({ runId });

    if (!result) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    if (result.run.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      run: result.run,
      events: result.events,
      artifacts: result.artifacts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
