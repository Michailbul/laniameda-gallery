import { redirect } from "next/navigation";
import { publicModePath } from "@/lib/public-modes";

// /worlds is the short name of the public page ("Public / Worlds"): it opens
// the worlds view of the selected-work surface, query and all.
export default async function PublicWorldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => query.append(key, entry));
    else if (value !== undefined) query.set(key, value);
  }
  const search = query.toString();
  const path = publicModePath("worlds");
  redirect(search ? `${path}?${search}` : path);
}
