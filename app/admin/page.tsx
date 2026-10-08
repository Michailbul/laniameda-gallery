import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/server/app-user";
import { isCurationAdmin } from "@/lib/server/admin";
import { AdminShell } from "./admin-shell";
import { AdminSignIn } from "./admin-sign-in";

export const metadata = {
  title: "Admin · Laniameda",
  // The signed-out branch is a sign-in form. Nothing here should be indexed.
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const user = await getAppUser();

  // Keep admin sign-in available here too; the main gallery now has its own
  // login entry at `/`.
  if (!user) {
    return <AdminSignIn />;
  }

  // Signed in but not a curation admin — `/` is their vault, so send them there.
  if (!isCurationAdmin(user.ownerUserId)) {
    redirect("/");
  }

  return (
    <AdminShell
      user={{
        id: user.ownerUserId,
        email: user.email ?? null,
        firstName: user.name ?? null,
        username: user.telegramUsername ?? null,
        photoUrl: user.avatarUrl ?? null,
      }}
    />
  );
}
