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

  // No session: sign in here rather than redirect. `/` would have bounced a
  // signed-out visitor to the public profile, which left the owner with no
  // address to type when their session lapsed — this is that address.
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
