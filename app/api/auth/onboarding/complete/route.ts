import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

const markOnboardingCompletedMutation = makeFunctionReference<"mutation">(
  "users:markOnboardingCompleted",
);

export async function POST() {
  try {
    const appUser = await requireAppUser();
    const client = getServerConvexClient();
    await client.mutation(markOnboardingCompletedMutation, {
      userId: appUser.convexUserId as Id<"users">,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to mark onboarding complete.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
