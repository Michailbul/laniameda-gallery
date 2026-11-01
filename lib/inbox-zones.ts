// Hover zones on Inbox images: left third keeps, right third archives, the
// bottom middle comments. Which zones an image gets depends on the answers its
// card type takes (INBOX_CHOICES_BY_TYPE); a zone never offers an answer the
// backend would refuse.
import { INBOX_CHOICES_BY_TYPE, type InboxCardType, type InboxChoice } from "./inbox";

export type ZoneKind = "keep" | "archive" | "comment";
export type ZoneAnswer = { choice: InboxChoice; targetHotkey?: number; pickedAssetId?: string };
export type ZoneActions = { keep?: ZoneAnswer; archive?: ZoneAnswer; comment: boolean };

type ZoneCard = {
  type: InboxCardType;
  targets?: readonly { hotkey: number; kind: string; missing?: boolean }[] | null;
};

export function zoneActions(card: ZoneCard, assetId: string, canComment = true): ZoneActions {
  const takes = (choice: InboxChoice) => INBOX_CHOICES_BY_TYPE[card.type].includes(choice);
  const actions: ZoneActions = { comment: canComment };
  // Keep: the card's own positive answer for this one image.
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

const same = (a: ZoneAnswer | undefined, b: Partial<ZoneAnswer> | null | undefined) =>
  Boolean(a && b && a.choice === b.choice && a.targetHotkey === b.targetHotkey && a.pickedAssetId === b.pickedAssetId);

// Whether the card's current answer is this image's keep or archive.
export function zoneState(actions: ZoneActions, answer: Partial<ZoneAnswer> | null | undefined) {
  const normalized = answer ? {
    choice: answer.choice, targetHotkey: answer.choice === "target" ? answer.targetHotkey : undefined,
    pickedAssetId: answer.choice === "pick" || answer.choice === "winner" ? answer.pickedAssetId : undefined,
  } : null;
  return { kept: same(actions.keep, normalized), archived: same(actions.archive, normalized) };
}

// The zone under a point given as 0–1 fractions of the image box.
export function zoneAt(x: number, y: number, actions: ZoneActions): ZoneKind | null {
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  if (x < 0.33) return actions.keep ? "keep" : null;
  if (x > 0.67) return actions.archive ? "archive" : null;
  if (y > 0.64) return actions.comment ? "comment" : null;
  return null;
}
