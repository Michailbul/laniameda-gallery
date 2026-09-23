// The public surface splits work into two mediums. A piece tagged "animation"
// is Animation; EVERYTHING else is Live action — a missing "live action" tag
// never hides a piece from the Live action view.

export type Medium = "animation" | "live-action";

const tagKey = (name: string) =>
  name.trim().toLowerCase().replace(/^#+/, "").replace(/[_-]+/g, " ").trim();

export const isAnimationTag = (name: string) => tagKey(name) === "animation";

export const isLiveActionLabel = (name: string) => tagKey(name) === "live action";

export const mediumOf = (tagNames: readonly string[] | undefined): Medium =>
  tagNames?.some(isAnimationTag) ? "animation" : "live-action";

export const MEDIUM_OPTIONS: { id: "all" | Medium; label: string }[] = [
  { id: "all", label: "All" },
  { id: "animation", label: "Animation" },
  { id: "live-action", label: "Live action" },
];
