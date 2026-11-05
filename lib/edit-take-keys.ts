// Keys 1 (approve) and 2 (discard) on a landed in-place edit take: the one
// under the pointer, else the one open in the wipe. The pages that host the
// edit panel bind 1 and 2 to their own frame, so their key handlers ask this
// first; it answers true when the panel took the key. Kept apart from the
// panel so a page that code-splits the panel does not load it for this.
type TakeKeyHandler = (event: KeyboardEvent) => boolean;

let current: TakeKeyHandler | null = null;

export const setEditTakeKeyHandler = (handler: TakeKeyHandler | null) => {
  current = handler;
};
export const clearEditTakeKeyHandler = (handler: TakeKeyHandler) => {
  if (current === handler) current = null;
};
export const handleEditTakeKey = (event: KeyboardEvent) => current?.(event) ?? false;
