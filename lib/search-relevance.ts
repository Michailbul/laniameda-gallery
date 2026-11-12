// Wording and thresholds of the agents' relevance check (convex/searchVerify.ts,
// convex/searchVerifyJev.ts). Pure: shared by the Convex runtime, the Node
// action and tests.
//
// Measured on 29 searches graded by independent judges (12 Nov 2026,
// agent-docs/SEARCH_EVAL.md). Naming "small, far off or only in the
// background" as a no is what moved right results from 79% to 88%: without
// it a castle on a distant ridge counted as "a castle on a hill".

export const RELEVANCE_WHOLE_TRUE =
  "Someone who asked for this would want this exact piece: every part of the request is plainly there, and what was asked for is a main subject of the picture.";
export const RELEVANCE_WHOLE_FALSE =
  "The piece shows something else; or what was asked for is small, far off or only in the background; or a requested detail (colour, setting, style, time of day, weather, who it is) is missing or doubtful.";
export const RELEVANCE_PART_TRUE = "This is plainly so in the picture.";
export const RELEVANCE_PART_FALSE = "This is absent, doubtful, or true only of something small or in the background.";

// match = whole-request answer x weakest part. At 0.7: 88% of returned pieces
// right by a strict judge, none wrong, 84% of the right pieces kept.
export const RELEVANCE_MATCH_AT = 0.7;
// The whole-request answer alone at 0.5: the main subject is there, a detail
// may be doubtful. Offered as "near", so nothing the agent might want is lost.
export const RELEVANCE_NEAR_AT = 0.5;

export type RelevanceTier = "match" | "near";

export const relevanceTier = (match: number, whole: number): RelevanceTier | undefined =>
  match >= RELEVANCE_MATCH_AT ? "match" : whole >= RELEVANCE_NEAR_AT ? "near" : undefined;
