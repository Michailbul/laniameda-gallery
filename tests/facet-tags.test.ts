import { describe, expect, test } from "bun:test";
import { buildFacetRequest, compactAnswers, decideFacetTags, FACET_QUESTIONS } from "../lib/facet-tags";

const sure = (choice: string, confidence = 0.97) => ({ choice, confidence });
const names = (tags: { name: string }[]) => tags.map((tag) => tag.name).sort();

describe("decideFacetTags", () => {
  const story = {
    domain: sure("story_art"), medium: sure("render_3d", 0.95), type: sure("scene"), setting: sure("interior"),
    light: sure("night"), shot: sure("wide"), horror: { p: 0.95 }, romance: { p: 0.4 },
  };

  test("fills every empty slot from sure answers", () => {
    expect(names(decideFacetTags(story, { tagNames: [], isInspiration: false }))).toEqual(
      ["3d-render", "animation", "horror", "interior", "night", "scene", "wide-shot"],
    );
  });

  test("never touches a slot that already holds a tag", () => {
    const tags = names(decideFacetTags(story, { tagNames: ["character", "animation", "Exterior", "day"], isInspiration: false }));
    expect(tags).not.toContain("scene");
    expect(tags).not.toContain("interior");
    expect(tags).not.toContain("night");
    expect(tags).toContain("3d-render");
  });

  test("a film or live-action picture never gets 3D", () => {
    expect(names(decideFacetTags(story, { tagNames: ["film"], isInspiration: false }))).not.toContain("3d-render");
    expect(names(decideFacetTags(story, { tagNames: ["live-action"], isInspiration: false }))).not.toContain("3d-render");
  });

  test("golden hour on a plain backdrop is studio light, not a tag", () => {
    const tags = names(decideFacetTags({ ...story, light: sure("golden_hour", 0.95), setting: sure("neither", 0.6) }, { tagNames: [], isInspiration: false }));
    expect(tags).not.toContain("golden-hour");
  });

  test("3D needs 0.9: a 0.8 render_3d adds no medium", () => {
    const tags = names(decideFacetTags({ ...story, medium: sure("render_3d", 0.8) }, { tagNames: [], isInspiration: false }));
    expect(tags).not.toContain("animation");
    expect(tags).not.toContain("3d-render");
  });

  test("golden hour needs 0.9, night does not", () => {
    const golden = names(decideFacetTags({ ...story, light: sure("golden_hour", 0.87) }, { tagNames: [], isInspiration: false }));
    expect(golden).not.toContain("golden-hour");
    const night = names(decideFacetTags({ ...story, light: sure("night", 0.87) }, { tagNames: [], isInspiration: false }));
    expect(night).toContain("night");
  });

  test("fashion needs 0.95, so costume art for a world is not fashion", () => {
    const tags = names(decideFacetTags({ domain: sure("fashion", 0.9), type: sure("character") }, { tagNames: [], isInspiration: false }));
    expect(tags).toEqual(["character"]);
    expect(names(decideFacetTags({ domain: sure("fashion", 0.98) }, { tagNames: ["inspiration"], isInspiration: true }))).toEqual(["fashion"]);
  });

  test("macro is a known shot but adds no tag", () => {
    expect(names(decideFacetTags({ ...story, shot: sure("macro") }, { tagNames: [], isInspiration: false }))).not.toContain("macro");
  });

  test("moods stay off a car render", () => {
    const tags = names(decideFacetTags({ domain: sure("vehicle", 0.7), horror: { p: 0.99 } }, { tagNames: ["inspiration"], isInspiration: true }));
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

test("the request asks every question once, in order, about one picture", () => {
  const body = buildFacetRequest("AAAA");
  expect(body.input[0]!.content[1]).toEqual({ type: "input_image", image_url: "data:image/jpeg;base64,AAAA", detail: "high" });
  expect(body.questions).toHaveLength(Object.keys(FACET_QUESTIONS).length);
  expect(body.questions[0]!.type).toBe("choice");
});

test("compactAnswers maps the ordered answers back to their keys", () => {
  const keys = Object.keys(FACET_QUESTIONS);
  const answers = keys.map((key) => key === "medium"
    ? { choice: "render_3d", probability: 0.5, probabilities: [{ value: "render_3d", probability: 0.98765 }] }
    : key === "horror" ? { probability: 0.9 } : {});
  expect(compactAnswers(answers)).toEqual({ medium: { choice: "render_3d", confidence: 0.988 }, horror: { p: 0.9 } });
});
