import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/server/app-user";
import { mintServerActorToken } from "@/lib/server/convex";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

// The browser's Convex client fetches its identity here. The token names the
// signed-in session's ownerUserId and lives for an hour; the client asks again
// before it expires.
export async function GET() {
  try {
    const user = await getAppUser();
    if (!user) {
      return NextResponse.json({ token: null }, { status: 401, headers: noStore });
    }
    const token = mintServerActorToken(user.ownerUserId) ?? null;
    return NextResponse.json({ token }, { headers: noStore });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to issue a Convex token.";
    return NextResponse.json({ error: message }, { status: 500, headers: noStore });
  }
}
