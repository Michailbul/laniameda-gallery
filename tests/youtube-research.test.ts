import { expect, test } from "bun:test";
import { currentResearchTags, parseResearch, privateResearchFields } from "../lib/youtube-research";
import { filtersToSearch, matchesFilters, parseFilters, type PublicVideo } from "../lib/youtube-page";

const draft = {
  v: 1, checkedAt: "2026-10-05T14:00:00Z", sourceVerdict: "Format only", validation: "Channel age fails.",
  bends: [{ niche: "cars", title: "How Banned F1 Cars Actually Work", verdict: "Untested", why: "Experiment", tension: "Rivals object", urgency: "Evergreen", thumbnail: "Four drawn cars", style: "Ink on paper", format: "Four mechanisms", first30: ["Promise", "Conflict", "Payoff"], demand: { summary: "Topic interest", evidence: [{ id: "--gfBRgeIZo", title: "Banned car", views: 5987007 }] }, saturation: { summary: "Crossing not proved", evidence: [] }, externalDemand: { source: "Wikipedia", summary: "Broad interest", url: "https://pageviews.wmcloud.org/" }, toCheck: ["Ban citations"] }],
};

test("current channel failure overrides stale merged eligibility labels", () => {
  const bendIdea = JSON.stringify(draft);
  expect(parseResearch(bendIdea)?.bends[0].first30).toEqual(["Promise", "Conflict", "Payoff"]);
  const row = { bendIdea, tagNames: ["drawn", "passes-filters", "fresh-channel", "has-bend"] };
  expect(currentResearchTags(row)).toEqual(["drawn", "has-bend"]);
  expect(row.tagNames).toContain("passes-filters");
  expect(currentResearchTags({ ...row, bendIdea: JSON.stringify({ ...draft, sourceVerdict: "Proven" }) })).toEqual(row.tagNames);
});

test("shared-password visitors receive no private proposals, notes or likes", () => {
  const row = { bendIdea: "private business proposal", userNote: "private feedback", isLiked: true };
  expect(privateResearchFields(row, false)).toEqual({});
  expect(JSON.stringify(privateResearchFields(row, false))).not.toContain("private");
  expect(privateResearchFields(row, true)).toEqual(row);
});

test("legacy text and corrupt or backend-clipped research fail safely", () => {
  expect(parseResearch("Try this for cars")).toBeNull();
  expect(parseResearch('{"v":1,"bends":[')).toBeNull();
  expect(parseResearch(JSON.stringify({ v: 1, bends: [{}] }))).toBeNull();
  expect(parseResearch(" ".repeat(4001))).toBeNull();
});

test("proposal filtering is shareable and cannot reveal missing private data", () => {
  const themes = ["youtube-niche-bend"];
  const filter = parseFilters({ theme: themes[0], ideas: "1" }, themes);
  expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToSearch(filter))), themes)).toEqual(filter);
  const video: PublicVideo = { externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Source", collections: themes, tagNames: [], frames: [] };
  expect(matchesFilters(video, filter)).toBe(false);
  expect(matchesFilters({ ...video, bendIdea: "Our F1 proposal" }, filter)).toBe(true);
  expect(matchesFilters({ ...video, bendIdea: "Our F1 proposal" }, { ...filter, query: "f1" })).toBe(true);
});
