import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";
import { isCurationAdmin } from "@/lib/server/admin";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAppUser();
    if (!isCurationAdmin(user.ownerUserId)) {
      return NextResponse.json(
        { error: "Only gallery admins can delete workflows." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    if (!id?.trim()) {
      return NextResponse.json(
        { error: "Workflow id is required." },
        { status: 400 },
      );
    }

    const client = getServerConvexClient();
    await client.mutation(api.workflows.deleteWorkflow, {
      id: id as Id<"workflows">,
      ownerUserId: user.ownerUserId,
    });

    return NextResponse.json({
      deleted: true,
      workflowId: id,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to delete workflow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
