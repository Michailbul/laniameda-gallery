import { describe, expect, test } from "bun:test";
import {
  parseStorybookRecord,
  placeFrames,
  shortenUrl,
  splitRefs,
} from "../lib/storybook-reader";

// 10 Oct: upper-case sections, a status line, beats with time ranges.
const october10 = `WHAT SHE KEEPS · about 30 seconds · da-film · overcast-day look (live action)
NOT READY: 1 blocking gaps

STORY
1. 0–6 seconds. At the canal quay, wind pulls an open letter toward the water.
2. 6–12 seconds. She opens the rescued fold.
3. 12–18 seconds. She tears it once, then once again.

CAST
- The patterned-jacket heroine: same adult woman, gray-green eyes. Sheet: asset:j578fhhfysqwkcqwc3e6zrpzgd8g0xyg. Complete photographic face.
- One visible character only. No new name is established.

LOCATIONS
- Quiet canal quay, overcast afternoon: basalt water edge, dressed limestone paving. Production plate: missing.
- Visually reviewed Gallery source, reference-only: https://cdn.midjourney.com/04d21c48-bbed-48df-ad2c-8b5bca2cfa91/0_0.png. The imported record is marked inspiration_capture.

PROPS
- Brocade satchel and tiny brass clip: asset:j578fhhfysqwkcqwc3e6zrpzgd8g0xyg; preserve these designs.

BEATS TO REFERENCES
1. Canal inner quay edge; heroine; asset:j578fhhfysqwkcqwc3e6zrpzgd8g0xyg; production quay plate and letter close reference missing; 6 seconds.
2. Same quay; heroine; asset:j578fhhfysqwkcqwc3e6zrpzgd8g0xyg; letter/pressed-flower detail missing; 6 seconds.

STYLE
Photographic human skin within photoreal AAA fantasy old city. World style lock: story:px79g76n0knnjavw1s1ectsm298gkfjn (the Film recipe).

GAPS
NO PLATE: cleared production canal-quay plate with dry seating area (beats 1–5). Cheapest first step: verify source eligibility at no generation cost.
NO PROP REFERENCE: folded letter, pressed flower and clip arrangement (beats 1–4). Cheapest fix: one close prop plate.
Minimum proposed visual-fix batch: 3 images, 300 credits.

ASSET LINKS
asset:j578fhhfysqwkcqwc3e6zrpzgd8g0xyg`;

// 13 Oct: a draft line, a world line, a logline, bare beats, keyed paragraphs,
// an audit with a dashed GAPS list.
const october13 = `Revised story draft · 30–45 seconds
DADDY ISSUES — RETRO-FUTURE · clean-2d-feature

With her hand on the door, a woman who always leaves at dawn notices a spare key and chooses to stay for coffee.

1. She turns the bedroom door handle with her jacket half on.
2. She lets the handle go and lifts the key.
3. From the bed, he stirs but leaves her room to decide.

Style lock: Clean 2D feature animation, cream/tan/black palette.

Board status: Nine compatible sources remain.

Gallery readiness audit, 13 October 2026
NOT READY: 2 blocking gaps

GAPS
- NO SHEET: brown-haired man (beats 3, 5, 6)
- NO PLATE: apartment stove action area (beat 4), bedroom/café source does not show the stove layout

Preserve selected source sheets; ACTION UNPROVEN remains for door, key and keyring.`;

const october13Locks = `Cinematic shot draft · 20–25 seconds
DEAR ANNETE › Film › Dari · crimson valley (dari-red-valley)

Dari stands in a storm-dark field of crimson flowers.

1. Hold a low, medium-wide three-quarter side view of Dari standing.
2. She lifts the rose to just beneath her nose.

Character lock: Dari's exact civilian field-sheet identity, asset:j573femjps99gsc2rcckzrssj98fvzxv. Preserve the dark-haired adult woman.

Location lock: Use ONLY the first stormy crimson-field image, asset:j57bbfgg5aq19xtjgdjacnah3d8cnzy0.`;

// 27 Oct: free prose, no beats, no status.
const october27 = `Cable Tram Crossing · Film · scene board, 43 study frames filed 29 Oct 2026 (session da-cable-tram). Michael's dream of 27 Oct 2026, written so no prompt names a real city.

What is in the shot: a narrow middle-district street, houses pressed close on both sides. A thick steel cable runs down the middle about eleven metres above the cobbles.

Building blocks, in order: 1 street canyon with the cable only; 2 wooden cabin on its wire against sky; 3 white blade tower at a corner. Script: none yet; the frames are studies, not picked.`;

describe("parseStorybookRecord: 10 Oct format", () => {
  const model = parseStorybookRecord({ name: "DEAR ANNETE · What She Keeps", description: october10 });

  test("reads the header into title, duration, look and medium", () => {
    expect(model.title).toBe("What She Keeps");
    expect(model.world).toBe("DEAR ANNETE");
    expect(model.duration).toBe("30 s");
    expect(model.medium).toBe("live-action");
    expect(model.look).toEqual(["da-film", "overcast-day look"]);
    expect(model.status).toBe("not-ready");
    expect(model.blockingGaps).toBe(1);
  });

  test("beats carry their time range and the references block's notes", () => {
    expect(model.beats).toHaveLength(3);
    expect(model.beats[0].time).toBe("0–6 s");
    expect(model.beats[0].text).toBe("At the canal quay, wind pulls an open letter toward the water.");
    expect(model.beats[0].assetIds).toEqual(["j578fhhfysqwkcqwc3e6zrpzgd8g0xyg"]);
    expect(model.beats[0].missing).toBe("production quay plate and letter close reference missing");
    expect(model.beats[2].assetIds).toEqual([]);
  });

  test("cast, locations and props become labelled items with their asset ids", () => {
    expect(model.cast).toHaveLength(2);
    expect(model.cast[0].label).toBe("The patterned-jacket heroine");
    expect(model.cast[0].assetIds).toEqual(["j578fhhfysqwkcqwc3e6zrpzgd8g0xyg"]);
    expect(model.cast[1].label).toBeNull();
    expect(model.locations[0].label).toBe("Quiet canal quay, overcast afternoon");
    expect(model.locations[1].assetIds).toEqual([]);
    expect(model.props[0].label).toBe("Brocade satchel and tiny brass clip");
  });

  test("gaps become a checklist with the kind, the summary and the fix", () => {
    expect(model.gaps).toHaveLength(2);
    expect(model.gaps[0].kind).toBe("no plate");
    expect(model.gaps[0].summary).toBe("cleared production canal-quay plate with dry seating area (beats 1–5)");
    expect(model.gaps[0].detail).toStartWith("Cheapest first step");
    expect(model.gapNotes).toEqual(["Minimum proposed visual-fix batch: 3 images, 300 credits."]);
  });

  test("sources, story refs and asset ids are collected once each", () => {
    expect(model.sources).toEqual([
      {
        url: "https://cdn.midjourney.com/04d21c48-bbed-48df-ad2c-8b5bca2cfa91/0_0.png",
        label: "cdn.midjourney.com/…/0_0.png",
      },
    ]);
    expect(model.storyRefs).toEqual(["px79g76n0knnjavw1s1ectsm298gkfjn"]);
    expect(model.assetIds).toEqual(["j578fhhfysqwkcqwc3e6zrpzgd8g0xyg"]);
    expect(model.sections.map((section) => section.title)).toEqual(["Style"]);
  });
});

describe("parseStorybookRecord: 13 Oct format", () => {
  test("reads the draft line, the world line, the logline and bare beats", () => {
    const model = parseStorybookRecord({ name: "DADDY ISSUES — RETRO-FUTURE · Coffee for Two", description: october13 });
    expect(model.draftKind).toBe("Revised story draft");
    expect(model.duration).toBe("30–45 s");
    expect(model.look).toEqual(["clean-2d-feature"]);
    expect(model.logline).toStartWith("With her hand on the door");
    expect(model.beats).toHaveLength(3);
    expect(model.beats[0].time).toBeNull();
    expect(model.status).toBe("not-ready");
    expect(model.blockingGaps).toBe(2);
    expect(model.gaps.map((gap) => gap.kind)).toEqual(["no sheet", "no plate"]);
    expect(model.gaps[0].summary).toBe("brown-haired man (beats 3, 5, 6)");
    expect(model.sections[0].items.map((item) => item.label)).toEqual(["Style lock", "Board status"]);
    expect(model.prose.some((paragraph) => paragraph.startsWith("Gallery readiness audit"))).toBe(true);
  });

  test("character and location locks become cast and locations", () => {
    const model = parseStorybookRecord({ name: "DEAR ANNETE · The Rose That Stays", description: october13Locks });
    expect(model.world).toBe("DEAR ANNETE");
    expect(model.look).toEqual(["Film", "Dari", "crimson valley", "dari-red-valley"]);
    expect(model.cast).toHaveLength(1);
    expect(model.cast[0].label).toBe("Character lock");
    expect(model.cast[0].assetIds).toEqual(["j573femjps99gsc2rcckzrssj98fvzxv"]);
    expect(model.locations[0].assetIds).toEqual(["j57bbfgg5aq19xtjgdjacnah3d8cnzy0"]);
    expect(model.status).toBe("unreviewed");
  });
});

describe("parseStorybookRecord: 27 Oct free prose", () => {
  test("keeps the prose, finds no beats and no gaps", () => {
    const model = parseStorybookRecord({ name: "Cable Tram Crossing", description: october27, worldName: "DEAR ANNETE" });
    expect(model.title).toBe("Cable Tram Crossing");
    expect(model.world).toBe("DEAR ANNETE");
    expect(model.beats).toEqual([]);
    expect(model.gaps).toEqual([]);
    expect(model.status).toBe("unreviewed");
    expect(model.look).toEqual(["Film"]);
    expect(model.prose[0]).toStartWith("Scene board, 43 study frames");
    expect(model.logline).toBeNull();
    expect(model.sections[0].items.map((item) => item.label)).toEqual(["What is in the shot"]);
    expect(model.prose[1]).toStartWith("Building blocks");
  });

  test("a plain sentence first line is prose, not a header", () => {
    const model = parseStorybookRecord({ name: "Two Pears", description: "Two pears sit on the sill. She eats one." });
    expect(model.prose).toEqual(["Two pears sit on the sill. She eats one."]);
    expect(model.duration).toBeNull();
  });
});

describe("parseStorybookRecord: the script fills what the description lacks", () => {
  test("an empty description reads the script; the script's logline and hook come through", () => {
    const model = parseStorybookRecord({
      name: "DEAR ANNETE · What She Keeps",
      description: "",
      script: { body: october10, logline: "She keeps the flower.", hook: "Wind takes the letter.", assetIds: ["j57awrdzcwcb00gb1386q1ba698e0zcc"], styleTag: "da-film" },
    });
    expect(model.beats).toHaveLength(3);
    expect(model.logline).toBe("She keeps the flower.");
    expect(model.hook).toBe("Wind takes the letter.");
    expect(model.assetIds).toEqual(["j578fhhfysqwkcqwc3e6zrpzgd8g0xyg", "j57awrdzcwcb00gb1386q1ba698e0zcc"]);
    expect(model.look).toEqual(["da-film", "overcast-day look"]);
  });

  test("a free-prose description still gets the script's beats and gaps", () => {
    const model = parseStorybookRecord({ name: "DEAR ANNETE · What She Keeps", description: october27, script: { body: october10 } });
    expect(model.beats).toHaveLength(3);
    expect(model.gaps).toHaveLength(2);
    expect(model.status).toBe("not-ready");
  });
});

describe("placeFrames", () => {
  const model = parseStorybookRecord({ name: "DEAR ANNETE · What She Keeps", description: october10 });
  const frames = [
    { id: "a", notes: "Film location plate for What She Keeps, beat 1: stormy quay.", tagNames: ["location"] },
    { id: "b", notes: "Film location plate, beat 3: close quay edge.", tagNames: ["location"] },
    { id: "c", notes: "Michael liked it in Midjourney.", tagNames: ["location"] },
    { id: "d", notes: "Original heroine design.", tagNames: ["character"] },
  ];

  test("a frame naming a beat sits beside it; location plates no beat claimed go to the Locations block", () => {
    const placed = placeFrames(model, frames);
    expect(placed.byBeat.get(1)?.map((frame) => frame.id)).toEqual(["a"]);
    expect(placed.byBeat.get(3)?.map((frame) => frame.id)).toEqual(["b"]);
    expect(placed.plates.map((frame) => frame.id)).toEqual(["c"]);
    expect(placed.strip.map((frame) => frame.id)).toEqual(["d"]);
  });

  test("with no beat mentioned, scene frames take the beats in shelf order", () => {
    const placed = placeFrames(model, [
      { id: "s1", notes: "frame", tagNames: ["scene"] },
      { id: "s2", notes: "frame", tagNames: ["scene"] },
      { id: "p", notes: "plate", tagNames: ["location"] },
      { id: "s3", notes: "frame", tagNames: ["scene"] },
      { id: "s4", notes: "frame", tagNames: ["scene"] },
    ]);
    expect(placed.byBeat.get(1)?.[0].id).toBe("s1");
    expect(placed.byBeat.get(2)?.[0].id).toBe("s2");
    expect(placed.byBeat.get(3)?.[0].id).toBe("s3");
    expect(placed.plates.map((frame) => frame.id)).toEqual(["p"]);
    expect(placed.strip.map((frame) => frame.id)).toEqual(["s4"]);
  });

  test("with no beats at all, everything is the strip", () => {
    const prose = parseStorybookRecord({ name: "Cable Tram Crossing", description: october27 });
    const placed = placeFrames(prose, frames);
    expect(placed.byBeat.size).toBe(0);
    expect(placed.plates).toEqual([]);
    expect(placed.strip).toHaveLength(4);
  });
});

describe("refs", () => {
  test("splitRefs cuts text at asset, story and url references", () => {
    const refs = splitRefs("Sheet: asset:j578fhhfysqwkcqwc3e6zrpzgd8g0xyg. See https://cdn.midjourney.com/abc/0_0.png. Lock story:px79g76n0knnjavw1s1ectsm298gkfjn.");
    expect(refs).toEqual([
      { kind: "text", text: "Sheet: " },
      { kind: "asset", id: "j578fhhfysqwkcqwc3e6zrpzgd8g0xyg" },
      { kind: "text", text: ". See " },
      { kind: "url", url: "https://cdn.midjourney.com/abc/0_0.png", label: "cdn.midjourney.com/…/0_0.png" },
      { kind: "text", text: "." },
      { kind: "text", text: " Lock " },
      { kind: "story", id: "px79g76n0knnjavw1s1ectsm298gkfjn" },
      { kind: "text", text: "." },
    ]);
  });

  test("shortenUrl keeps the host and the file", () => {
    expect(shortenUrl("https://www.midjourney.com/jobs/448b8d2c-48d6-4d77-aeb2-53850989a912?index=3")).toBe("midjourney.com/…/448b8d2c-4…0989a912");
    expect(shortenUrl("https://example.com")).toBe("example.com");
  });
});

describe("sections from the description and the script fold together", () => {
  test("a STYLE section present in both reads once", () => {
    const model = parseStorybookRecord({
      name: "DEAR ANNETE · What She Keeps",
      description: october10,
      script: { body: `${october10}\n\nSOURCE NOTES\nLocation source: asset:j57awrdzcwcb00gb1386q1ba698e0zcc.` },
    });
    expect(model.sections.map((section) => section.title)).toEqual(["Style", "Source notes"]);
    expect(model.sections[0].paragraphs).toHaveLength(1);
    expect(model.cast).toHaveLength(2);
  });
});
