import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { WorldPitch } from "@/components/world-page/world-pitch";
import { WORLD_PAGE_SIZE, parseWorldSection } from "@/components/world-page/types";
import { getAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

export const metadata: Metadata = {
  title: "World page admin — Laniameda",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

// The world page as its owner curates it: the same page with every member,
// private, dropped and letterboxed ones marked, and the owner keys on the
// hovered frame. Anyone else gets a 404: the read is signed for the session's
// user, and the backend answers null for a world that is not theirs.
export default async function WorldAdminPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const user = await getAppUser().catch(() => null);
  if (!user?.ownerUserId) notFound();

  const section = parseWorldSection(one(query.view));
  const side = one(query.side);
  const client = getServerConvexClient(user.ownerUserId);
  const read = await Promise.all([
    client.query(api.worldPage.getWorldPageAdmin, {
      ownerUserId: user.ownerUserId,
      slug,
      ...(side ? { side } : {}),
    }),
    client.query(api.worldPage.listWorldPageAdmin, {
      ownerUserId: user.ownerUserId,
      slug,
      ...(side ? { side } : {}),
      ...(section ? { section } : {}),
      paginationOpts: { numItems: WORLD_PAGE_SIZE, cursor: null },
    }),
  ]).catch((error: unknown) => {
    // A session Convex refuses (signature, expiry) is not the owner here.
    console.warn("world admin: signed read refused", error);
    return null;
  });
  if (!read?.[0]) notFound();
  const [world, first] = read;

  return (
    <WorldPitch
      slug={slug}
      initialSide={world.side}
      initialSection={section}
      initialWorld={world}
      initialPage={first.page}
      mode="admin"
    />
  );
}
