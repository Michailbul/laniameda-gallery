// Owner hotkeys on a hovered frame, in one place for every surface that has
// them: the vault (components/gallery/asset-review-controls.tsx) and the
// public world page (components/world-page). One key, one meaning everywhere.
//
// Taken elsewhere, so not used here: ` opens Feedback (feedback-button),
// 1–9 answer Decisions cards and F zooms there (inbox/stack-screen, its own
// screen), E/C/0 drive the inbox zoom viewer, S saves the world doc editor.
export const ASSET_HOTKEYS = {
  /** Archive: recoverable for ten minutes, then the normal delete cascade. */
  archive: "d",
  /** Feature / unfeature: the curator star. Featured pieces lead public pages. */
  feature: "f",
  comment: "c",
  scene: "v",
} as const;

export type AssetHotkey = (typeof ASSET_HOTKEYS)[keyof typeof ASSET_HOTKEYS];

const ALL_KEYS = new Set<string>(Object.values(ASSET_HOTKEYS));

/**
 * The asset hotkey this event presses, or null when the event belongs to
 * someone else: a repeat, an IME composition, a modifier chord, or typing in
 * a field or editable text.
 */
export const assetHotkeyOf = (event: KeyboardEvent): AssetHotkey | null => {
  if (
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return null;
  const target = event.target as HTMLElement | null;
  if (
    target?.isContentEditable ||
    target?.closest?.("input, textarea, select, [role=textbox]")
  )
    return null;
  const key = event.key.toLowerCase();
  return ALL_KEYS.has(key) ? (key as AssetHotkey) : null;
};
