export type TagFilterMode = "include" | "exclude";
export type SelectedTagFilters = Record<string, TagFilterMode>;

const EXCLUDE_ZONE_THRESHOLD = 0.68;

export function resolveTagFilterModeFromClickPosition(
  width: number,
  offsetX: number,
): TagFilterMode {
  if (width <= 0) {
    return "include";
  }
  const normalizedOffsetX = Math.max(0, Math.min(offsetX, width));
  return normalizedOffsetX >= width * EXCLUDE_ZONE_THRESHOLD
    ? "exclude"
    : "include";
}

export function getNextSelectedTagFilters(
  previous: SelectedTagFilters,
  tagKey: string,
  mode: TagFilterMode,
): SelectedTagFilters {
  const current = previous[tagKey];
  if (current === mode) {
    const { [tagKey]: _removed, ...remaining } = previous;
    return remaining;
  }
  return {
    ...previous,
    [tagKey]: mode,
  };
}
