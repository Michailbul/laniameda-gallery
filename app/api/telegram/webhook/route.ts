import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: "Telegram webhook ingestion has been removed from this app.",
    },
    { status: 410 },
  );
}
