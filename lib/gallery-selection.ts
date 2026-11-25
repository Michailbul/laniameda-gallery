type GalleryItemType = "asset" | "pack" | "design" | "skill" | "storybook" | "collection";

type SelectableEntry<Member extends { id: string }> = {
  id: string;
  galleryItemType?: GalleryItemType;
  previewImages?: ReadonlyArray<Member>;
};

/**
 * The asset ids a grid tile stands for when it is selected. A plain frame is
 * itself; a stack (a prompt pack, e.g. the four frames of one Midjourney job)
 * is every frame inside it, so box-select, cmd+A and a click on a stack hand
 * the whole stack to Move, Delete and the rest of the selection bar.
 * Collection, storybook and skill cards open something else and stay out.
 */
export function selectionIdsOf(entry: SelectableEntry<{ id: string }>): string[] {
  if (entry.galleryItemType === "asset" || entry.galleryItemType === undefined) {
    return [entry.id];
  }
  if (entry.galleryItemType === "pack") {
    return Array.from(
      new Set([entry.id, ...(entry.previewImages ?? []).map((member) => member.id)]),
    );
  }
  return [];
}

/**
 * Grid entries by asset id, with a stack's frames listed under their own ids.
 * A stack's cover entry carries the union of its members' collections, so the
 * cover id resolves to the cover's own member record: a bulk move then keeps
 * each frame's own storybook memberships instead of the whole stack's.
 */
export function indexEntriesWithStackMembers<
  Member extends { id: string },
  Entry extends SelectableEntry<Member>,
>(entries: ReadonlyArray<Entry>): Map<string, Entry | (Member & { galleryItemType: "asset" })> {
  const byId = new Map<string, Entry | (Member & { galleryItemType: "asset" })>();
  for (const entry of entries) {
    if (entry.galleryItemType === "pack" && entry.previewImages?.length) {
      for (const member of entry.previewImages) {
        if (!byId.has(member.id)) byId.set(member.id, { ...member, galleryItemType: "asset" });
      }
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
      continue;
    }
    byId.set(entry.id, entry);
  }
  return byId;
}
