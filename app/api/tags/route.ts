import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";

export async function GET() {
  try {
    const client = getServerConvexClient();
    const tags = await client.query(api.tags.listTags, {});
    return NextResponse.json({ tags });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load tags.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

