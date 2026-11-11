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
// The styles page (components/styles) has its own map; 1 and R mean the same
// there (it also takes ⇧1 for a super like).
export const ASSET_HOTKEYS = {
  /**
   * Like. Pressed twice quickly (LIKE_DOUBLE_MS) it is a super like: "this
   * image is ready to use". On a liked or super-liked frame one press takes
   * the like off. Private: it never publishes.
   */
  like: "1",
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

/**
 * R promotes the hovered frame (or the selection) to the director review:
 * it opens the promote palette. Shift+R sends it straight to the last
 * destination used for that frame's review project. Kept apart from
 * ASSET_HOTKEYS because it is the one frame key that takes Shift.
 */
export const PROMOTE_HOTKEY = "r";

export type PromoteHotkey = "open" | "last";

const ALL_KEYS = new Set<string>(Object.values(ASSET_HOTKEYS));
// The only key that takes Shift: Shift+H pairs a hero frame.
const SHIFT_KEYS = new Set<string>([ASSET_HOTKEYS.hero]);

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
  // event.code keeps the 1 and 2 keys digits on layouts where they type something else.
  const digit = !event.shiftKey && /^Digit[12]$/.test(event.code) ? event.code.slice(5) : null;
  const key = digit ?? event.key.toLowerCase();
  if (!ALL_KEYS.has(key)) return null;
  if (event.shiftKey && !SHIFT_KEYS.has(key)) return null;
  return key as AssetHotkey;
};

/** R → "open" (the palette), Shift+R → "last" (send at once); else null. */
export const promoteHotkeyOf = (event: KeyboardEvent): PromoteHotkey | null => {
  if (event.key.toLowerCase() !== PROMOTE_HOTKEY) return null;
  if (belongsElsewhere(event, true)) return null;
  return event.shiftKey ? "last" : "open";
};

// --- Like and super like (key 1) ---------------------------------------------

export type LikeLevel = "none" | "like" | "super";

/** A second 1 on the same frame within this many ms makes the like a super like. */
export const LIKE_DOUBLE_MS = 350;

export const likeLevelOf = (liked?: boolean, superLiked?: boolean | number): LikeLevel =>
  superLiked ? "super" : liked ? "like" : "none";
