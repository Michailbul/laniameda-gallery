import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/server/app-user";

export async function GET() {
  try {
    const user = await getAppUser();
    return NextResponse.json({ user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
