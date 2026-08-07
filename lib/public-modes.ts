import { TASTE_PROFILE_PATH } from "./routes";

// The public surface has exactly three modes. This toggle IS the navigation —
// no sidebar, no filter bar, nothing else to learn.
//
// The list lives here rather than in `public-nav.tsx` because the route segment
// validates against it, and a server component can't reach into a "use client"
// module for plain data without dragging the component along.
export const PUBLIC_MODES = [
  {
    id: "featured",
    label: "Featured work",
    title: "Start here.",
    blurb: "The pieces I'd show you first.",
  },
  {
    id: "worlds",
    label: "Worlds",
    title: "Explore the worlds I'm building.",
    blurb:
      "Each world is a story universe — its scenes, its characters, its locations.",
  },
  {
    id: "browse",
    label: "Browse",
    title: "Everything else.",
    blurb: "The working archive. Filter it, or just scroll.",
  },
] as const;

export type PublicMode = (typeof PUBLIC_MODES)[number]["id"];

export const isPublicMode = (value: string): value is PublicMode =>
  PUBLIC_MODES.some((entry) => entry.id === value);

/** Every mode is a real URL, so a view can be linked, bookmarked and shared. */
export const publicModePath = (mode: PublicMode) =>
  `${TASTE_PROFILE_PATH}/${mode}`;

/** Where the public surface starts. The bare taste-profile path redirects here
 *  so each view has exactly one canonical URL instead of Featured having two. */
export const PUBLIC_HOME_PATH = publicModePath("featured");
