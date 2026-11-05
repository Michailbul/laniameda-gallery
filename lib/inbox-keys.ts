// Number keys on the hovered Inbox image (and in the zoom view): 1 approve
// (A, K), 2 archive (X), 3 comment (C), 4 open or close the zoom. E opens
// the zoom with the in-place edit panel. Which keys
// an image takes depends on the answers its card type takes
// (INBOX_CHOICES_BY_TYPE); a key never sends an answer the backend refuses.
import { INBOX_CHOICES_BY_TYPE, type InboxCardType, type InboxChoice } from "./inbox";

export type ImageKey = "keep" | "archive" | "comment" | "open";
export type ImageAnswer = { choice: InboxChoice; targetHotkey?: number; pickedAssetId?: string };
export type ImageActions = { keep?: ImageAnswer; archive?: ImageAnswer; comment: boolean };

type KeyCard = {
  type: InboxCardType;
  targets?: readonly { hotkey: number; kind: string; missing?: boolean }[] | null;
};

export function imageActions(card: KeyCard, assetId: string, canComment = true): ImageActions {
  const takes = (choice: InboxChoice) => INBOX_CHOICES_BY_TYPE[card.type].includes(choice);
  const actions: ImageActions = { comment: canComment };
  // Approve: the card's own positive answer for this one image.
  if (takes("keep")) actions.keep = { choice: "keep" };
  else if (takes("pick")) actions.keep = { choice: "pick", pickedAssetId: assetId };
  else if (takes("winner")) actions.keep = { choice: "winner", pickedAssetId: assetId };
  // Archive: "out", or on a sort card its Out target when it has one.
  if (takes("out")) actions.archive = { choice: "out" };
  else if (card.type === "sort") {
    const out = card.targets?.find((target) => target.kind === "out" && !target.missing);
    if (out) actions.archive = { choice: "target", targetHotkey: out.hotkey };
  }
  return actions;
}

const same = (a: ImageAnswer | undefined, b: Partial<ImageAnswer> | null | undefined) =>
  Boolean(a && b && a.choice === b.choice && a.targetHotkey === b.targetHotkey && a.pickedAssetId === b.pickedAssetId);

// Whether the card's current answer is this image's approve or archive; a
// second press of the same key then takes the answer back.
export function imageState(actions: ImageActions, answer: Partial<ImageAnswer> | null | undefined) {
  const normalized = answer ? {
    choice: answer.choice, targetHotkey: answer.choice === "target" ? answer.targetHotkey : undefined,
    pickedAssetId: answer.choice === "pick" || answer.choice === "winner" ? answer.pickedAssetId : undefined,
  } : null;
  return { kept: same(actions.keep, normalized), archived: same(actions.archive, normalized) };
}

// The image key a keypress means; `code` keeps digits right on any layout.
export function imageKeyOf(key: string, code = ""): ImageKey | null {
  const digit = /^(?:Digit|Numpad)([1-4])$/.exec(code)?.[1] ?? (/^[1-4]$/.test(key) ? key : undefined);
  if (digit) return (["keep", "archive", "comment", "open"] as const)[Number(digit) - 1]!;
  switch (key.toLowerCase()) {
    case "a": case "k": return "keep";
    case "x": return "archive";
    case "c": return "comment";
    default: return null;
  }
}

export const isDigitKey = (key: string, code = "") => /^(?:Digit|Numpad)\d$/.test(code) || /^\d$/.test(key);

// The key hint pinned bottom-left: only the keys this card type takes. On a
// sort card's own image the numbers drop on targets, so it shows letters.
export function imageKeyHint(actions: ImageActions, mode: { zoom?: boolean; letters?: boolean; edit?: boolean } = {}) {
  const keys: { key: string; label: string; tone: ImageKey | "edit" }[] = [];
  const k = (digit: string, letter: string) => (mode.letters ? letter : digit);
  if (actions.keep) keys.push({ key: k("1", "A"), label: "approve", tone: "keep" });
  if (actions.archive) keys.push({ key: k("2", "X"), label: "archive", tone: "archive" });
  if (actions.comment) keys.push({ key: k("3", "C"), label: "comment", tone: "comment" });
  keys.push({ key: mode.zoom ? "4" : k("4", "F"), label: mode.zoom ? "close" : "open", tone: "open" });
  // E: an in-place edit on the image (the zoom opens with the edit panel).
  if (mode.edit) keys.push({ key: "E", label: "edit", tone: "edit" });
  return keys;
}
