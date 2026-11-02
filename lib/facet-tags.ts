// Auto-tagging of every new picture with OpenAI's Decisions API (gpt-6-luna):
// the questions asked of the picture, and the rule that turns the answers into
// gallery tags.
//
// One request per picture, every question at once. The list is short on
// purpose: only tags that help find world-building material (what the picture
// is, how it is made, inside or out, the light, wide or close, character
// sheets, romance and horror), plus the kind of a design and the angle of a
// car. Moods the models could not judge (melancholy, glamour), and tags no one
// filters by (couple, crowd, world detail, celebration, game view, macro,
// product), were dropped on 2 Nov 2026.
//
// Thresholds come from 173 vault pictures labelled by eye on 2 Nov 2026
// (Dear Annette/tagging-test-2026-11-02): Luna got 696 tags right, 15 wrong,
// against Jev's 453 right, 3 wrong. A slot that already holds a tag is never
// touched: the classifier fills gaps, it does not overrule a person or an agent.

export const FACET_MODEL = "gpt-6-luna";
export const FACETS_VERSION = 2;

type Choice = { kind: "choice"; ask: string; options: Record<string, string> };
type YesNo = { kind: "yesno"; ask: string };
export type FacetQuestion = Choice | YesNo;

export const FACET_QUESTIONS: Record<string, FacetQuestion> = {
  domain: { kind: "choice", ask: "What field does the picture belong to?", options: {
    story_art: "Art for a story world: a film still, animation frame, illustration or concept art, including character and costume art for a story world, even a character in ornate costume posed on a plain backdrop.",
    design: "Graphic or digital design: a website, app screen, poster, logo, typography, branding, packaging or a colour palette.",
    vehicle: "A car, motorcycle or other vehicle as the subject, a design or photo reference for vehicles.",
    fashion: "Real-world fashion: a runway, lookbook or editorial photo of real clothes, or clothing and accessories shown as products. Not a character from a story world.",
    architecture: "Architecture or interior design as the subject: a building, a room design, furniture.",
    product: "A product shot: an object photographed or rendered to show the product itself.",
    other: "Anything else: a meme, a chart, a document, a plain photo with no clear field.",
  } },
  medium: { kind: "choice", ask: "How is the picture made?", options: {
    live_action: "A photograph or live-action film still: real people and places shot through a real camera lens, photographic skin, fabric and light.",
    painted_2d: "Drawn or painted 2D animation or illustration: painted or flat shapes, drawn lines, gouache or cel paint, a hand-made 2D look.",
    render_3d: "A 3D render or CG animation frame: modelled and lit 3D surfaces, sculpted or toy-like figures, glossy lacquer, metal or clay materials.",
    graphic: "Flat graphic design or a screen: type, layout, vector shapes, UI elements.",
  } },
  type: { kind: "choice", ask: "What kind of picture is it?", options: {
    character: "A portrait or figure study: one or two people are the subject and fill the frame, the place is only a backdrop. Character sheets, close-ups, full-length poses.",
    location: "A place: architecture, a street, a room, a city or a landscape, with no people or with people so small they are only scale.",
    scene: "A moment of story: people doing something in a place, where both the people and the place matter.",
  } },
  setting: { kind: "choice", ask: "Where is the picture set?", options: {
    interior: "Inside a building: a room, hall, stairwell, café, theatre, cellar or any enclosed space.",
    exterior: "Outdoors: a street, square, rooftop, garden, field, sky, city view or landscape.",
    neither: "No real setting: a plain backdrop, studio background, character sheet, screen or abstract ground.",
  } },
  light: { kind: "choice", ask: "What time of day or light is the picture in?", options: {
    day: "Daylight: clear or overcast day, white or blue light.",
    golden_hour: "Low warm sun outdoors: golden hour, sunrise or sunset light with long shadows.",
    dusk: "Dusk or twilight: blue hour, the sky still lit but darkening, first lamps on.",
    night: "Night: dark sky or darkness, lit by moon, lamps, candles, fire or neon.",
    studio: "Studio or neutral light on a plain backdrop, warm or cool, or no light at all (a flat design).",
  } },
  shot: { kind: "choice", ask: "How close is the camera?", options: {
    wide: "A wide or establishing shot: the whole place or building is visible, people are small in it.",
    medium: "A medium or full shot: people shown full length or from the waist up, with some of the place around them.",
    close_up: "A close-up: a face, head and shoulders, or hands fill most of the frame.",
    macro: "A macro or extreme detail: one small object, texture, eye, jewel or ornament fills the frame.",
  } },
  design_type: { kind: "choice", ask: "If the picture is a design, what kind of design is it?", options: {
    ui: "An app or software screen, a dashboard or UI components.",
    web_design: "A website page or landing page.",
    poster: "A poster, flyer, cover or editorial layout.",
    logo: "A logo, wordmark or icon.",
    branding: "A brand identity: several applications of one brand, stationery, mockups.",
    typography: "Lettering or a typeface specimen where the letters are the subject.",
    color_palette: "A colour palette or swatches.",
    not_design: "Not a design.",
  } },
  car_angle: { kind: "choice", ask: "If the picture shows a vehicle, from which side is it seen?", options: {
    front: "From the front.",
    rear: "From the back.",
    side: "From the side, in profile.",
    three_quarter: "A three-quarter view, front or rear corner.",
    cabin: "The inside: dashboard, seats, cabin.",
    detail: "A close detail: a wheel, light, badge or surface.",
    not_vehicle: "No vehicle.",
  } },
  character_sheet: { kind: "yesno", ask: "The picture is a character sheet: one character shown in several views or poses, or a full-length figure with a close-up, on a plain background." },
  romance: { kind: "yesno", ask: "The picture is romantic: love, desire, longing, a kiss, an embrace or a couple's intimacy." },
  horror: { kind: "yesno", ask: "The picture is frightening or menacing: demons, monsters, a threat, danger, dread or gore." },
};

export type FacetAnswer = { choice?: string; confidence?: number; p?: number };
export type FacetAnswers = Record<string, FacetAnswer>;

const KEYS = Object.keys(FACET_QUESTIONS);

/** The Decisions API request for one picture, already a JPEG in base64. Answers come back in this order. */
export const buildFacetRequest = (jpegBase64: string) => ({
  model: FACET_MODEL,
  input: [{ role: "user", content: [
    { type: "input_text", text: "A picture saved into a creative reference gallery." },
    { type: "input_image", image_url: `data:image/jpeg;base64,${jpegBase64}`, detail: "high" },
  ] }],
  questions: KEYS.map((key) => {
    const question = FACET_QUESTIONS[key]!;
    return question.kind === "choice"
      ? { type: "choice", instructions: question.ask, choices: Object.entries(question.options).map(([value, description]) => ({ value, description })) }
      : { type: "predicate", instructions: question.ask };
  }),
});

type RawAnswer = { choice?: string; probability?: number; probabilities?: { label?: string; value?: string; probability: number }[] };

/** Keeps what the rule and a later recalibration need: choice + confidence, or a yes/no probability. */
export const compactAnswers = (answers: RawAnswer[]): FacetAnswers => {
  const out: FacetAnswers = {};
  KEYS.forEach((key, index) => {
    const answer = answers[index];
    if (!answer) return;
    if (FACET_QUESTIONS[key]!.kind === "yesno") {
      if (typeof answer.probability === "number") out[key] = { p: round(answer.probability) };
      return;
    }
    if (!answer.choice) return;
    const picked = answer.probabilities?.find((option) => (option.value ?? option.label) === answer.choice);
    out[key] = { choice: answer.choice, confidence: round(picked?.probability ?? answer.probability ?? 0) };
  });
  return out;
};
const round = (value: number) => Math.round(value * 1000) / 1000;

export type TagCategory = "content_type" | "environment" | "lighting" | "camera_angle" | "design_type" | "car_angle";
export type FacetTag = { name: string; category?: TagCategory; reason: string };

/** Slots: a tag of the slot already on the asset leaves the whole slot alone. */
const SLOTS = {
  type: ["character", "location", "scene", "inspiration"],
  // A Film-world still is tagged film: its medium is settled.
  medium: ["animation", "live-action", "live action", "film"],
  setting: ["interior", "exterior"],
  light: ["day", "golden-hour", "dusk", "night"],
  shot: ["wide-shot", "close-up", "macro"],
} as const;

// Confidence each answer needs before it becomes a tag.
const SURE: Record<string, number> = {
  domain: 0.8, medium: 0.7, type: 0.7, setting: 0.9, light: 0.85, shot: 0.7, design_type: 0.7, car_angle: 0.7,
};
const SURE_YES = 0.9;
// Luna rarely over-calls 3D (1 of 83 non-3D pictures), so 0.9 is enough.
const SURE_3D = 0.9;
// Warm studio light and daylight were read as golden hour (so it also needs
// a real setting, not a plain backdrop); story-world character art on a plain
// backdrop was read as fashion.
const SURE_GOLDEN = 0.9;
const SURE_FASHION = 0.95;

const tagKey = (name: string) => name.trim().toLowerCase().replace(/[\s_]+/g, "-");

export type ClassifyContext = {
  tagNames: string[];
  /** Saved as someone else's work (a capture from the web): the piece type is inspiration. */
  isInspiration: boolean;
};

/** The tags the answers add to one asset. Never removes, never fills a slot that holds a tag. */
export const decideFacetTags = (answers: FacetAnswers, context: ClassifyContext): FacetTag[] => {
  const have = new Set(context.tagNames.map(tagKey));
  const empty = (slot: keyof typeof SLOTS) => !SLOTS[slot].some((name) => have.has(tagKey(name)));
  const sure = (key: string, bar = SURE[key] ?? 0.9) => {
    const answer = answers[key];
    return answer?.choice && (answer.confidence ?? 0) >= bar ? answer.choice : undefined;
  };
  const yes = (key: string) => (answers[key]?.p ?? 0) >= SURE_YES;
  const out: FacetTag[] = [];
  const add = (name: string, reason: string, category?: TagCategory) => {
    if (have.has(tagKey(name)) || out.some((tag) => tagKey(tag.name) === tagKey(name))) return;
    out.push({ name, category, reason });
  };

  const domainSure = sure("domain");
  const domain = domainSure === "fashion" && !sure("domain", SURE_FASHION) ? undefined : domainSure;
  const pictorial = domain !== "design";

  // Piece type: captures of someone else's work are inspiration; the rest by eye.
  if (empty("type")) {
    if (context.isInspiration) add("inspiration", "saved from the web");
    else if (pictorial) {
      const type = sure("type");
      if (type) add(type, `type ${type}`, "content_type");
    }
  }

  const medium = sure("medium");
  const sure3d = medium === "render_3d" && (answers.medium?.confidence ?? 0) >= SURE_3D;
  if (empty("medium")) {
    if (medium === "live_action") add("live-action", "medium live action");
    if (medium === "painted_2d" || sure3d) add("animation", `medium ${medium}`);
  }
  if (sure3d && (empty("medium") || have.has("animation"))) add("3d-render", "medium render_3d");

  if (pictorial) {
    const setting = sure("setting");
    if (empty("setting") && (setting === "interior" || setting === "exterior")) add(setting, `setting ${setting}`, "environment");
    const light = sure("light");
    const lightTag = { day: "day", golden_hour: "golden-hour", dusk: "dusk", night: "night" }[light ?? ""];
    const lightSure = light !== "golden_hour"
      || ((answers.light?.confidence ?? 0) >= SURE_GOLDEN && answers.setting?.choice !== "neither");
    if (empty("light") && lightTag && lightSure) add(lightTag, `light ${light}`, "lighting");
    const shot = sure("shot");
    const shotTag = { wide: "wide-shot", close_up: "close-up" }[shot ?? ""];
    if (empty("shot") && shotTag) add(shotTag, `shot ${shot}`, "camera_angle");
    // Character sheets and moods describe story and fashion pictures; on a
    // car render or an abstract they misfire.
    if (domainSure === "story_art" || domainSure === "fashion") {
      if (yes("character_sheet")) add("character-sheet", "character_sheet", "content_type");
      if (yes("romance")) add("romance", "romance");
      if (yes("horror")) add("horror", "horror");
    }
  }

  if (domain === "design") {
    add("design", "domain design", "design_type");
    const kind = sure("design_type");
    const kindTag = { ui: "ui", web_design: "web-design", poster: "poster", logo: "logo", branding: "branding", typography: "typography", color_palette: "color-palette" }[kind ?? ""];
    if (kindTag) add(kindTag, `design ${kind}`, "design_type");
  }
  if (domain === "vehicle") {
    add("vehicle", "domain vehicle", "content_type");
    const angle = sure("car_angle");
    const angleTag = { front: "front", rear: "rear", side: "side", three_quarter: "three-quarter", cabin: "cabin", detail: "car-detail" }[angle ?? ""];
    if (angleTag) add(angleTag, `car ${angle}`, "car_angle");
  }
  if (domain === "fashion") add("fashion", "domain fashion", "content_type");
  if (domain === "architecture") add("architecture", "domain architecture", "design_type");
  return out;
};

/** Tags the Jev classifier (version 1) added that the trimmed list no longer makes. */
export const RETIRED_FACET_TAGS = ["couple", "melancholy", "glamour", "world-detail", "celebration", "crowd", "game-view", "macro", "product"];
