// Owner hotkeys on a hovered frame, in one place for every surface that has
// them: the vault (components/gallery/asset-review-controls.tsx) and the
// world page and its admin view (components/world-page). One key, one
// meaning everywhere.
//
// Taken elsewhere, so not used here: ` opens Feedback (feedback-button),
// 1–9 answer Decisions cards and F zooms there (inbox/stack-screen, its own
// screen), E/C/0 drive the inbox zoom viewer, S saves the world doc editor.
// 2 (drop from the world page) and O (open) are world-page keys; the vault
// ignores them.
export const ASSET_HOTKEYS = {
  /** Archive: recoverable for ten minutes, then the normal delete cascade. */
  archive: "d",
  /** Feature / unfeature: the curator star. Featured pieces lead public pages. */
  feature: "f",
  comment: "c",
  scene: "v",
  /** Hero: a full-screen insert on the world page. Shift+H pairs it into the previous one. */
  hero: "h",
  /** Drop from the world page (worldPageHidden), recoverable with 2 again. */
  drop: "2",
  /** Open the frame large. */
  open: "o",
} as const;

export type AssetHotkey = (typeof ASSET_HOTKEYS)[keyof typeof ASSET_HOTKEYS];

const ALL_KEYS = new Set<string>(Object.values(ASSET_HOTKEYS));
// The only key that takes Shift: Shift+H pairs a hero frame.
const SHIFT_KEYS = new Set<string>([ASSET_HOTKEYS.hero]);

/**
 * The asset hotkey this event presses, or null when the event belongs to
 * someone else: a repeat, an IME composition, a modifier chord, or typing in
 * a field or editable text. Shift is read by the caller (event.shiftKey) and
 * only passes for H.
 */
export const assetHotkeyOf = (event: KeyboardEvent): AssetHotkey | null => {
  if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target as HTMLElement | null;
  if (
    target?.isContentEditable ||
    target?.closest?.("input, textarea, select, [role=textbox]")
  )
    return null;
  // event.code keeps the 2 key a 2 on layouts where it types something else.
  const key = event.code === "Digit2" && !event.shiftKey ? "2" : event.key.toLowerCase();
  if (!ALL_KEYS.has(key)) return null;
  if (event.shiftKey && !SHIFT_KEYS.has(key)) return null;
  return key as AssetHotkey;
};
