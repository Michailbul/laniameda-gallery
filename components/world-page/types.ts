import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type WorldPageData = NonNullable<
  FunctionReturnType<typeof api.worldPage.getWorldPage>
>;
export type WorldTile = WorldPageData["featured"][number];

export const WORLD_SECTIONS = [
  { key: "characters", label: "Characters" },
  { key: "scenes", label: "Scenes" },
  { key: "locations", label: "Locations" },
] as const;
export type WorldSection = (typeof WORLD_SECTIONS)[number]["key"];

export const parseWorldSection = (value: unknown): WorldSection | undefined =>
  WORLD_SECTIONS.find((section) => section.key === value)?.key;

/** Tiles per page, on the server's first screen and every live page after. */
export const WORLD_PAGE_SIZE = 48;
