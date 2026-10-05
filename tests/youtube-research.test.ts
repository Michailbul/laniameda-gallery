import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchNotes } from "../components/youtube/research-notes";
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


const extended = (patch: Record<string, unknown> = {}) => ({
  ...draft,
  bends: [{
    ...draft.bends[0],
    audienceFit: { verdict: "Partial", summary: "Comparable mechanics videos use diagrams; target audience data is unavailable.", evidence: [{ id: "--gfBRgeIZo", title: "Banned car", views: 5987007 }] },
    adaptation: "Replace each source example with a banned car mechanism; keep the cutaway and explain the rule it broke.",
    previousAttempts: { summary: "One comparable topic attempt; this format crossing is still untested.", evidence: [{ id: "--gfBRgeIZo", title: "Banned car", views: 5987007 }] },
    urgencyEvidence: { summary: "A dated source is recorded here for the timing check.", url: "https://example.org/dated-source" },
    ...patch,
  }],
});

test("optional proposal checks round-trip without changing the private V1 contract", () => {
  const proposal = parseResearch(JSON.stringify(extended()));
  expect(proposal?.v).toBe(1);
  expect(proposal?.bends[0].audienceFit?.verdict).toBe("Partial");
  expect(proposal?.bends[0].adaptation).toContain("banned car mechanism");
  expect(proposal?.bends[0].previousAttempts?.evidence).toHaveLength(1);
  expect(proposal?.bends[0].urgencyEvidence?.url).toBe("https://example.org/dated-source");
  const old = parseResearch(JSON.stringify(draft));
  expect(old?.bends[0].audienceFit).toBeUndefined();
  expect(old?.bends[0].title).toBe(draft.bends[0].title);
});

test("optional checks reject unsupported verdicts, blank instructions, unsafe links and excess evidence", () => {
  const videos = Array.from({ length: 4 }, () => draft.bends[0].demand.evidence[0]);
  expect(parseResearch(JSON.stringify(extended({ audienceFit: { verdict: "Proven women", summary: "Unsupported", evidence: [] } })))).toBeNull();
  expect(parseResearch(JSON.stringify(extended({ audienceFit: { verdict: "Unknown", summary: " ", evidence: [] } })))).toBeNull();
  expect(parseResearch(JSON.stringify(extended({ audienceFit: { verdict: "Supported", summary: "Visual comparison", evidence: videos } })))).toBeNull();
  expect(parseResearch(JSON.stringify(extended({ previousAttempts: { summary: "Examples", evidence: videos } })))).toBeNull();
  expect(parseResearch(JSON.stringify(extended({ adaptation: " " })))).toBeNull();
  expect(parseResearch(JSON.stringify(extended({ urgencyEvidence: { summary: "Source", url: "http://example.org/news" } })))).toBeNull();
  expect(parseResearch(JSON.stringify(extended({ urgencyEvidence: { summary: "Source", url: "javascript:alert(1)" } })))).toBeNull();
  expect(parseResearch(JSON.stringify(extended({ adaptation: "x".repeat(4000) })))).toBeNull();
});

test("popular demos never upgrade an unknown audience or prove gender fit", () => {
  const value = JSON.stringify(extended({ audienceFit: { verdict: "Unknown", summary: "Whether women watch this format has not been measured.", evidence: [{ id: "--gfBRgeIZo", title: "Banned car", views: 5987007 }] } }));
  expect(parseResearch(value)?.bends[0].audienceFit?.verdict).toBe("Unknown");
  const html = renderToStaticMarkup(ResearchNotes({ value }));
  expect(html).toContain("visual style fit · Unknown");
  expect(html).toContain("They do not establish viewer demographics.");
  expect(html).not.toContain("visual style fit · Supported");
});

test("older proposals retain their title and show missing checks honestly", () => {
  const html = renderToStaticMarkup(ResearchNotes({ value: JSON.stringify(draft) }));
  expect(html).toContain(draft.bends[0].title);
  expect(html).toContain("Target niche · cars");
  expect(html).toContain("visual style fit · Unknown");
  expect(html).toContain("Previous attempts at this niche and format have not been checked.");
  expect(html).toContain("Adaptation instructions have not been recorded yet.");
  expect(html).toContain("the timing claim is unverified.");
});

test("extended proposals reuse linked thumbnail evidence and adaptation notes", () => {
  const html = renderToStaticMarkup(ResearchNotes({ value: JSON.stringify(extended()) }));
  expect(html).toContain("visual style fit · Partial");
  expect(html).toContain("Previous attempts evidence");
  expect(html).toContain("https://www.youtube.com/watch?v=--gfBRgeIZo");
  expect(html).toContain("https://i.ytimg.com/vi/--gfBRgeIZo/mqdefault.jpg");
  expect(html).toContain("https://example.org/dated-source");
  expect(html).toContain("banned car mechanism");
});
