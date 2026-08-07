import { redirect } from "next/navigation";
import { PUBLIC_HOME_PATH } from "@/lib/public-modes";

// The bare taste-profile path is the surface's name, not one of its views.
// Featured lives at its own URL like the other two, so this forwards there
// rather than rendering the same page under a second address.
//
// The query is carried across by hand — `redirect()` takes a literal location
// and would otherwise drop it, breaking every `?asset=<id>` share link that was
// copied from this path before the views had their own URLs.
export default async function TasteProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.set(key, value);
  }

  const query = params.toString();
  redirect(query ? `${PUBLIC_HOME_PATH}?${query}` : PUBLIC_HOME_PATH);
}
