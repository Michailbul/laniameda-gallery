import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/server/app-user";
import { isCurationAdmin } from "@/lib/server/admin";
import { AdminShell } from "./admin-shell";

export const metadata = {
  title: "Admin · Laniameda",
};

export default async function AdminPage() {
  const user = await getAppUser();
  if (!user || !isCurationAdmin(user.ownerUserId)) {
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
