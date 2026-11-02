import { describe, expect, test } from "bun:test";
import { buildJevRequest, compactAnswers, decideFacetTags, JEV_QUESTIONS } from "../lib/jev-facets";

const sure = (choice: string, confidence = 0.97) => ({ choice, confidence });
const names = (tags: { name: string }[]) => tags.map((tag) => tag.name).sort();

describe("decideFacetTags", () => {
  const story = {
    domain: sure("story_art"), medium: sure("render_3d", 0.995), type: sure("scene"), setting: sure("interior"),
    light: sure("night"), shot: sure("wide"), people: sure("crowd"), horror: { p: 0.95 }, romance: { p: 0.4 },
  };

  test("fills every empty slot from sure answers", () => {
    expect(names(decideFacetTags(story, { tagNames: [], isInspiration: false }))).toEqual(
      ["3d-render", "animation", "crowd", "horror", "interior", "night", "scene", "wide-shot"],
    );
  });

  test("never touches a slot that already holds a tag", () => {
    const tags = names(decideFacetTags(story, { tagNames: ["character", "live-action", "Exterior", "day"], isInspiration: false }));
    expect(tags).not.toContain("scene");
    expect(tags).not.toContain("animation");
    expect(tags).not.toContain("interior");
    expect(tags).not.toContain("night");
    expect(tags).toContain("3d-render");
  });

  test("3D only when certain: a 0.95 render_3d adds no medium", () => {
    const tags = names(decideFacetTags({ ...story, medium: sure("render_3d", 0.95) }, { tagNames: [], isInspiration: false }));
    expect(tags).not.toContain("animation");
    expect(tags).not.toContain("3d-render");
  });

  test("moods stay off a car render", () => {
    const tags = names(decideFacetTags({ domain: sure("vehicle", 0.7), horror: { p: 0.99 }, world_detail: { p: 0.95 } }, { tagNames: ["inspiration"], isInspiration: true }));
    expect(tags).toEqual([]);
  });

  test("leaves unsure answers out", () => {
    const tags = names(decideFacetTags({ ...story, type: sure("scene", 0.6), light: sure("night", 0.5) }, { tagNames: [], isInspiration: false }));
    expect(tags).not.toContain("scene");
    expect(tags).not.toContain("night");
  });

  test("a web capture is inspiration whatever it shows", () => {
    expect(names(decideFacetTags(story, { tagNames: [], isInspiration: true }))).toContain("inspiration");
    expect(names(decideFacetTags(story, { tagNames: [], isInspiration: true }))).not.toContain("scene");
  });

  test("a design gets design and its kind, no scene facets", () => {
    const tags = names(decideFacetTags(
      { domain: sure("design"), medium: sure("graphic"), design_type: sure("web_design"), setting: sure("interior"), type: sure("location") },
      { tagNames: ["inspiration"], isInspiration: true },
    ));
    expect(tags).toEqual(["design", "web-design"]);
  });

  test("a car gets vehicle and its angle", () => {
    const tags = names(decideFacetTags(
      { domain: sure("vehicle"), medium: sure("live_action"), car_angle: sure("three_quarter") },
      { tagNames: ["inspiration", "live-action"], isInspiration: true },
    ));
    expect(tags).toEqual(["three-quarter", "vehicle"]);
  });
});

test("the request asks every question once, about one picture", () => {
  const body = buildJevRequest("AAAA", "imgabc") as { state: Record<string, string>; assets: Record<string, unknown>; questions: Record<string, unknown> };
  expect(body.state).toEqual({ picture: "imgabc" });
  expect(Object.keys(body.assets)).toEqual(["imgabc"]);
  expect(Object.keys(body.questions)).toEqual(Object.keys(JEV_QUESTIONS));
});

test("compactAnswers keeps choice, confidence and noul probability", () => {
  expect(compactAnswers({
    medium: { type: "choice", choice: "render_3d", confidence: 0.98765 },
    horror: { type: "noul", noul: 0.9 },
  })).toEqual({ medium: { choice: "render_3d", confidence: 0.988 }, horror: { p: 0.9 } });
});
