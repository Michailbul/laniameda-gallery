// Owner hotkeys on a hovered frame, in one place for every surface that has
// them: the vault (components/gallery/asset-review-controls.tsx) and the
// public world page (components/world-page). One key, one meaning everywhere.
//
// Taken elsewhere, so not used here: ` opens Feedback (feedback-button),
// 1–9 answer Decisions cards and F zooms there (inbox/stack-screen, its own
// screen), E/C/0 drive the inbox zoom viewer, S saves the world doc editor.
// The styles page (components/styles) has its own map; R means the same there.
export const ASSET_HOTKEYS = {
  /** Archive: recoverable for ten minutes, then the normal delete cascade. */
  archive: "d",
  /** Feature / unfeature: the curator star. Featured pieces lead public pages. */
  feature: "f",
  comment: "c",
  scene: "v",
} as const;

export type AssetHotkey = (typeof ASSET_HOTKEYS)[keyof typeof ASSET_HOTKEYS];

/**
 * R promotes the hovered frame (or the selection) to the director review:
 * it opens the promote palette. Shift+R sends it straight to the last
 * destination used for that frame's review project. Kept apart from
 * ASSET_HOTKEYS because it is the one frame key that takes Shift.
 */
export const PROMOTE_HOTKEY = "r";

export type PromoteHotkey = "open" | "last";

const ALL_KEYS = new Set<string>(Object.values(ASSET_HOTKEYS));

/** A repeat, an IME composition, a modifier chord, or typing in a field. */
const belongsElsewhere = (event: KeyboardEvent, allowShift: boolean) => {
  if (
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (event.shiftKey && !allowShift)
  )
    return true;
  const target = event.target as HTMLElement | null;
  return Boolean(
    target?.isContentEditable ||
      target?.closest?.("input, textarea, select, [role=textbox]"),
  );
};

/**
 * The asset hotkey this event presses, or null when the event belongs to
 * someone else: a repeat, an IME composition, a modifier chord, or typing in
 * a field or editable text.
 */
export const assetHotkeyOf = (event: KeyboardEvent): AssetHotkey | null => {
  if (belongsElsewhere(event, false)) return null;
  const key = event.key.toLowerCase();
  return ALL_KEYS.has(key) ? (key as AssetHotkey) : null;
};

/** R → "open" (the palette), Shift+R → "last" (send at once); else null. */
export const promoteHotkeyOf = (event: KeyboardEvent): PromoteHotkey | null => {
  if (event.key.toLowerCase() !== PROMOTE_HOTKEY) return null;
  if (belongsElsewhere(event, true)) return null;
  return event.shiftKey ? "last" : "open";
};
