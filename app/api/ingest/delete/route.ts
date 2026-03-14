import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { requireAuth } from "@/lib/server-auth";

const deleteAction = makeFunctionReference<"action">("ingest:deleteFromApi");

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

export async function DELETE(request: Request) {
  try {
    const authUser = await requireAuth();
    const data = await readJson(request);
    if (!data) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const payload = {
      ...data,
      ownerUserId: authUser.id,
    };

    const client = getConvexClient();
    const result = await client.action(deleteAction, payload);

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
