import { expect, test } from "bun:test";
import { mjIdentityOf, mjMatches, parseLookupQuery, styleSlug, worldShortName } from "../lib/world-styles";
import { parseGalleryRoute, worldStylesPath } from "../lib/gallery-routes";

const JOB = "948eeca6-3032-4013-842b-2859d3b94070";

test("every way a board names a Midjourney frame resolves to its job and tile", () => {
  expect(parseLookupQuery(`https://www.midjourney.com/jobs/${JOB}?index=2`)).toMatchObject({ kind: "mj", job: JOB, index: 2 });
  expect(parseLookupQuery(`https://cdn.midjourney.com/${JOB}/0_3.png`)).toMatchObject({ kind: "mj", job: JOB, index: 3 });
  expect(parseLookupQuery(`mj-${JOB}-1.png`)).toMatchObject({ kind: "mj", job: JOB, index: 1 });
  expect(parseLookupQuery("948eeca6-2")).toMatchObject({ kind: "mj", job: "948eeca6", index: 2 });
  expect(parseLookupQuery(JOB)).toEqual({ kind: "mj", raw: JOB, job: JOB });
  expect(parseLookupQuery("asset:j57c68w42k0351x6cf14ymfq0d8hb8cc")).toMatchObject({ kind: "asset", assetId: "j57c68w42k0351x6cf14ymfq0d8hb8cc" });
  expect(parseLookupQuery("https://x.com/someone/status/1")).toMatchObject({ kind: "url" });
  expect(parseLookupQuery("style-lock:dear-annete:ink-noir")).toMatchObject({ kind: "name" });
});

test("a short board id matches the saved frame of that job and tile only", () => {
  const saved = mjIdentityOf({ sourceUrl: `https://www.midjourney.com/jobs/${JOB}?index=2`, fileName: `mj-${JOB}-2.png` });
  expect(mjMatches({ job: "948eeca6", index: 2 }, saved)).toBe(true);
  expect(mjMatches({ job: "948eeca6", index: 1 }, saved)).toBe(false);
  expect(mjMatches({ job: JOB }, saved)).toBe(true);
  expect(mjMatches({ job: "00000000", index: 2 }, saved)).toBe(false);
});

test("style names, world labels and the styles page address", () => {
  expect(styleSlug("Lacquer & Brass")).toBe("lacquer-and-brass");
  expect(styleSlug("Deco · Dark")).toBe("deco-dark");
  expect(worldShortName("DEAR ANNETE — 3D", "DEAR ANNETE")).toBe("3D");
  expect(worldShortName("IRON STAGE", "DEAR ANNETE")).toBe("IRON STAGE");
  expect(worldStylesPath("dear-annete", "ink-noir")).toBe("/w/dear-annete/styles/ink-noir");
  expect(parseGalleryRoute("/w/dear-annete/styles")).toBeNull();
  expect(parseGalleryRoute("/w/dear-annete/instructions")?.route).toMatchObject({ kind: "world", tab: "instructions" });
});
