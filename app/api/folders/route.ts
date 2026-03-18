import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

const badRequest = (error: string) =>
  NextResponse.json({ error }, { status: 400 });

const unauthorized = () =>
  NextResponse.json({ error: "Not authenticated." }, { status: 401 });

export async function GET() {
  try {
    const user = await requireAppUser();
    const client = getServerConvexClient();
    const folders = await client.query(api.folders.listFolders, {
      ownerUserId: user.ownerUserId,
    });
    return NextResponse.json({ folders });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return unauthorized();
    }
    const message =
      error instanceof Error ? error.message : "Failed to load folders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAppUser();
    const body = (await request.json().catch(() => null)) as
      | { name?: string; description?: string }
      | null;
    if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
      return badRequest("name is required.");
    }

    const client = getServerConvexClient();
    const result = await client.mutation(api.folders.createFolder, {
      ownerUserId: user.ownerUserId,
      name: body.name,
      description:
        typeof body.description === "string" ? body.description : undefined,
    });

    return NextResponse.json({
      folder: { _id: result.folderId },
      created: result.created,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return unauthorized();
    }
    const message =
      error instanceof Error ? error.message : "Failed to create folder.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
