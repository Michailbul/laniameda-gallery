// Auto-classification with Jev (TypeSafe System One): the questions asked of
// every new picture, and the rule that turns Jev's answers into gallery tags.
//
// One request per picture: the picture once in the state, every question in
// parallel. Answers become tags only when Jev is sure (calibrated on 180 Dear
// Annete frames on 2 Nov 2026: at 0.9 confidence type agreed 89/96, setting
// 82/85, light 30/30 with the existing labels, and medium caught CG renders
// filed as live action). A slot that already holds a tag is never touched:
// the classifier fills gaps, it does not overrule a person or an agent.

export const JEV_MODEL = "jev-latest";
export const JEV_FACETS_VERSION = 1;

type Choice = { kind: "choice"; ask: string; options: Record<string, string> };
type Noul = { kind: "noul"; ask: string };
export type JevQuestion = Choice | Noul;

export const JEV_QUESTIONS: Record<string, JevQuestion> = {
  domain: { kind: "choice", ask: "What field does `picture` belong to?", options: {
    story_art: "Art for a story world: a film still, animation frame, illustration, concept art, character or environment art.",
    design: "Graphic or digital design: a website, app screen, poster, logo, typography, branding, packaging or a colour palette.",
    vehicle: "A car, motorcycle or other vehicle as the subject, a design or photo reference for vehicles.",
    fashion: "Fashion: clothing, runway, lookbook, accessories or a styled outfit as the subject.",
    architecture: "Architecture or interior design as the subject: a building, a room design, furniture.",
    product: "A product shot: an object photographed or rendered to show the product itself.",
    other: "Anything else: a meme, a chart, a document, a plain photo with no clear field.",
  } },
  medium: { kind: "choice", ask: "How is `picture` made?", options: {
    live_action: "A photograph or live-action film still: real people and places shot through a real camera lens, photographic skin, fabric and light.",
    painted_2d: "Drawn or painted 2D animation or illustration: painted or flat shapes, drawn lines, gouache or cel paint, a hand-made 2D look.",
    render_3d: "A 3D render or CG animation frame: modelled and lit 3D surfaces, sculpted or toy-like figures, glossy lacquer, metal or clay materials.",
    graphic: "Flat graphic design or a screen: type, layout, vector shapes, UI elements.",
  } },
  type: { kind: "choice", ask: "What kind of picture is `picture`?", options: {
    character: "A portrait or figure study: one or two people are the subject and fill the frame, the place is only a backdrop. Character sheets, close-ups, full-length poses.",
    location: "A place: architecture, a street, a room, a city or a landscape, with no people or with people so small they are only scale.",
    scene: "A moment of story: people doing something in a place, where both the people and the place matter.",
  } },
  setting: { kind: "choice", ask: "Where is `picture` set?", options: {
    interior: "Inside a building: a room, hall, stairwell, café, theatre, cellar or any enclosed space.",
    exterior: "Outdoors: a street, square, rooftop, garden, field, sky, city view or landscape.",
    neither: "No real setting: a plain backdrop, studio background, character sheet, screen or abstract ground.",
  } },
  light: { kind: "choice", ask: "What time of day or light is `picture` in?", options: {
    day: "Daylight: clear or overcast day, white or blue light.",
    golden_hour: "Low warm sun: golden hour, sunrise or sunset light with long shadows.",
    dusk: "Dusk or twilight: blue hour, the sky still lit but darkening, first lamps on.",
    night: "Night: dark sky or darkness, lit by moon, lamps, candles, fire or neon.",
    studio: "Studio or neutral light on a plain backdrop, or no light at all (a flat design).",
  } },
  shot: { kind: "choice", ask: "How close is the camera in `picture`?", options: {
    wide: "A wide or establishing shot: the whole place or building is visible, people are small in it.",
    medium: "A medium or full shot: people shown full length or from the waist up, with some of the place around them.",
    close_up: "A close-up: a face, head and shoulders, or hands fill most of the frame.",
    macro: "A macro or extreme detail: one small object, texture, eye, jewel or ornament fills the frame.",
  } },
  people: { kind: "choice", ask: "How many people or creatures are the subject of `picture`?", options: {
    none: "Nobody: no people or creatures, or only tiny distant specks.",
    one: "One person or creature.",
    two: "Two people or creatures together.",
    group: "A small group of three to about eight.",
    crowd: "A crowd: many people filling the scene.",
  } },
  design_type: { kind: "choice", ask: "If `picture` is a design, what kind of design is it?", options: {
    ui: "An app or software screen, a dashboard or UI components.",
    web_design: "A website page or landing page.",
    poster: "A poster, flyer, cover or editorial layout.",
    logo: "A logo, wordmark or icon.",
    branding: "A brand identity: several applications of one brand, stationery, mockups.",
    typography: "Lettering or a typeface specimen where the letters are the subject.",
    color_palette: "A colour palette or swatches.",
    not_design: "Not a design.",
  } },
  car_angle: { kind: "choice", ask: "If `picture` shows a vehicle, from which side is it seen?", options: {
    front: "From the front.",
    rear: "From the back.",
    side: "From the side, in profile.",
    three_quarter: "A three-quarter view, front or rear corner.",
    cabin: "The inside: dashboard, seats, cabin.",
    detail: "A close detail: a wheel, light, badge or surface.",
    not_vehicle: "No vehicle.",
  } },
  character_sheet: { kind: "noul", ask: "Is `picture` a character sheet: one character shown in several views, poses or a turnaround on a plain background?" },
  game_view: { kind: "noul", ask: "Is `picture` a video game screenshot or game view: a HUD, an isometric or top-down play view, game UI?" },
  world_detail: { kind: "noul", ask: "Is `picture` a close look at a thing from a world, such as a prop, object, ornament, costume piece, machine or architectural detail, rather than at a person or a whole place?" },
  couple: { kind: "noul", ask: "Does `picture` show two people as a romantic couple?" },
  romance: { kind: "noul", ask: "Is `picture` romantic: love, desire, longing, a kiss, an embrace or a couple's intimacy?" },
  horror: { kind: "noul", ask: "Is `picture` frightening or menacing: demons, monsters, a threat, danger, dread or gore?" },
  melancholy: { kind: "noul", ask: "Is `picture` melancholy: sadness, loneliness, grief, waiting or loss?" },
  glamour: { kind: "noul", ask: "Is `picture` about glamour: elegance, couture, jewels, posing, luxury or seduction?" },
  celebration: { kind: "noul", ask: "Does `picture` show a celebration: a ball, dance, party, feast, carnival or performance?" },
};

export type JevAnswer = { choice?: string; confidence?: number; p?: number };
export type JevAnswers = Record<string, JevAnswer>;

export const PICTURE_REF = "picture";

/** The System One request body for one picture, already a JPEG in base64. */
export const buildJevRequest = (jpegBase64: string, assetRef: string) => {
  const questions: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(JEV_QUESTIONS)) {
    questions[key] = question.kind === "choice"
      ? { type: "choice", instructions: question.ask, criteria: question.options }
      : { type: "noul", instructions: question.ask };
  }
  return {
    model: JEV_MODEL,
    state: { [PICTURE_REF]: assetRef },
    assets: { [assetRef]: { type: "image", format: "jpg", data_base64: jpegBase64 } },
    questions,
  };
};

type RawAnswer = { type: string; choice?: string; confidence?: number; noul?: number };

/** Keeps what the rule and a later recalibration need: choice + confidence, or a noul's probability. */
export const compactAnswers = (answers: Record<string, RawAnswer>): JevAnswers => {
  const out: JevAnswers = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (answer.type === "noul" && typeof answer.noul === "number") out[key] = { p: round(answer.noul) };
    else if (answer.choice) out[key] = { choice: answer.choice, confidence: round(answer.confidence ?? 0) };
  }
  return out;
};
const round = (value: number) => Math.round(value * 1000) / 1000;

export type TagCategory = "content_type" | "environment" | "lighting" | "camera_angle" | "composition" | "design_type" | "car_angle";
export type FacetTag = { name: string; category?: TagCategory; reason: string };

/** Slots: a tag of the slot already on the asset leaves the whole slot alone. */
const SLOTS = {
  type: ["character", "location", "scene", "inspiration"],
  medium: ["animation", "live-action", "live action"],
  setting: ["interior", "exterior"],
  light: ["day", "golden-hour", "dusk", "night"],
  shot: ["wide-shot", "close-up", "macro"],
} as const;

const SURE = 0.9;
const SURE_NOUL = 0.9;
const SURE_DOMAIN = 0.85;
// Jev leans to "3D render" on cinematic Midjourney stills (38 of 60 Film
// frames at 0.9; the ones at 0.99+ were clearly CG): 3D only when certain.
const SURE_3D = 0.99;
// Glamour fired on candlelit scenes and editorials at 0.9.
const SURE_GLAMOUR = 0.95;

const tagKey = (name: string) => name.trim().toLowerCase().replace(/[\s_]+/g, "-");

export type ClassifyContext = {
  tagNames: string[];
  /** Saved as someone else's work (a capture from the web): the piece type is inspiration. */
  isInspiration: boolean;
};

/** The tags Jev's answers add to one asset. Never removes, never fills a slot that holds a tag. */
export const decideFacetTags = (answers: JevAnswers, context: ClassifyContext): FacetTag[] => {
  const have = new Set(context.tagNames.map(tagKey));
  const empty = (slot: keyof typeof SLOTS) => !SLOTS[slot].some((name) => have.has(tagKey(name)));
  const sure = (key: string) => {
    const answer = answers[key];
    return answer?.choice && (answer.confidence ?? 0) >= SURE ? answer.choice : undefined;
  };
  const yes = (key: string) => (answers[key]?.p ?? 0) >= SURE_NOUL;
  const out: FacetTag[] = [];
  const add = (name: string, reason: string, category?: TagCategory) => {
    if (have.has(tagKey(name)) || out.some((tag) => tagKey(tag.name) === tagKey(name))) return;
    out.push({ name, category, reason });
  };

  const domainAnswer = answers.domain;
  const domain = domainAnswer?.choice && (domainAnswer.confidence ?? 0) >= SURE_DOMAIN ? domainAnswer.choice : undefined;
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
  const certain3d = medium === "render_3d" && (answers.medium?.confidence ?? 0) >= SURE_3D;
  if (empty("medium")) {
    if (medium === "live_action") add("live-action", "medium live action");
    if (medium === "painted_2d" || certain3d) add("animation", `medium ${medium}`);
  }
  if (certain3d) add("3d-render", "medium render_3d");

  if (pictorial) {
    const setting = sure("setting");
    if (empty("setting") && (setting === "interior" || setting === "exterior")) add(setting, `setting ${setting}`, "environment");
    const light = sure("light");
    const lightTag = { day: "day", golden_hour: "golden-hour", dusk: "dusk", night: "night" }[light ?? ""];
    if (empty("light") && lightTag) add(lightTag, `light ${light}`, "lighting");
    const shot = sure("shot");
    const shotTag = { wide: "wide-shot", close_up: "close-up", macro: "macro" }[shot ?? ""];
    if (empty("shot") && shotTag) add(shotTag, `shot ${shot}`, "camera_angle");
    if (sure("people") === "crowd") add("crowd", "people crowd", "composition");
    if (yes("game_view")) add("game-view", "game_view");
    // Moods, couples and world details describe story and fashion pictures;
    // on a car render or an abstract they misfire.
    if (domainAnswer?.choice === "story_art" || domainAnswer?.choice === "fashion") {
      for (const [key, tag] of [["couple", "couple"], ["romance", "romance"], ["horror", "horror"], ["melancholy", "melancholy"],
        ["celebration", "celebration"], ["world_detail", "world-detail"], ["character_sheet", "character-sheet"]] as const) {
        if (yes(key)) add(tag, key);
      }
      if ((answers.glamour?.p ?? 0) >= SURE_GLAMOUR) add("glamour", "glamour");
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
  if (domain === "product") add("product", "domain product", "content_type");
  return out;
};
