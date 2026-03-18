import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

type PositionInput = {
  assetId: string;
  x: number;
  y: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parsePositions = (value: unknown): PositionInput[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as { assetId?: unknown; x?: unknown; y?: unknown };
      if (
        typeof record.assetId !== "string" ||
        !record.assetId.trim() ||
        !isFiniteNumber(record.x) ||
        !isFiniteNumber(record.y)
      ) {
        return null;
      }
      return {
        assetId: record.assetId,
        x: record.x,
        y: record.y,
      };
    })
    .filter((entry): entry is PositionInput => Boolean(entry));

  return parsed.length === value.length ? parsed : null;
};

export async function GET() {
  try {
    const user = await requireAppUser();
    const client = getServerConvexClient();
    const positions = await client.query(api.canvasPositions.listPositions, {
      ownerUserId: user.ownerUserId,
    });
    return NextResponse.json({ positions });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load canvas positions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAppUser();
    const body = (await request.json().catch(() => null)) as
      | { positions?: unknown }
      | null;
    const positions = parsePositions(body?.positions);
    if (!positions) {
      return NextResponse.json(
        { error: "positions must be an array of { assetId, x, y }." },
        { status: 400 },
      );
    }

    const client = getServerConvexClient();
    const updated = await client.mutation(api.canvasPositions.batchUpsertPositions, {
      ownerUserId: user.ownerUserId,
      positions: positions.map((position) => ({
        assetId: position.assetId as Id<"assets">,
        x: position.x,
        y: position.y,
      })),
    });

    return NextResponse.json({ updated });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to save canvas positions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

