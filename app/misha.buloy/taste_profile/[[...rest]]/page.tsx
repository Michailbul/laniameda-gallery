import { redirect } from "next/navigation";
import { SELECTED_WORK_PATH } from "@/lib/routes";

// The public surface used to live at /misha.buloy/taste_profile. Every link
// copied from there — a view, a `?asset=<id>` share — still lands: the same
// segments and query are forwarded to the new address.
//
// A 307, not a permanent redirect: browsers cache a 308 for good, and this
// address should stay easy to point somewhere else later.
export default async function LegacyTasteProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ rest?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { rest = [] } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => query.append(key, entry));
    else if (value !== undefined) query.set(key, value);
  }

  const path = rest.length > 0 ? `${SELECTED_WORK_PATH}/${rest.join("/")}` : SELECTED_WORK_PATH;
  const search = query.toString();
  redirect(search ? `${path}?${search}` : path);
}
