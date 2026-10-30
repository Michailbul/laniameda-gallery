// Dear Annete prompt packs. One pack is one breath: a short phrase that goes
// into the Midjourney prompt box verbatim. Edit phrases here, not in the UI.
//
// Every phrase is taken from the world's own lexicon in the gallery: the world
// bible, docs/midjourney.md section 7 and the three style locks (open_world
// dear-annete). No real city, landmark, river, artist or brand is named; places
// are described by level, material and light. Aspect ratios and every other
// flag stay out of the phrases: they belong to the prompt's parameters.
(function registerPromptPackData(globalScope) {
  "use strict";

  const groups = [
    {
      heading: "Style",
      note: "one per prompt; Film goes last, the animation openers first",
      packs: [
        {
          id: "film",
          label: "Film 35mm",
          phrase:
            "Shot on 35mm tungsten 500T colour negative film, printed photochemically. Organic grain, heaviest in the shadows. Red-orange halation glows around every lamp and lantern. Soft blooming highlights, vintage spherical lenses wide open. Honey, amber and rose light. Warm brown-black shadows with a faint green cast, a low-contrast print.",
        },
        { id: "3d", label: "3D", phrase: "Cinematic 3D animation frame." },
        {
          id: "deco-dark",
          label: "Deco dark",
          phrase:
            "Dark art deco animation frame, a hand-painted background with visible brushstrokes and flat graphic shapes.",
        },
        {
          id: "deco-bright",
          label: "Deco bright",
          phrase:
            "Bright art deco animation frame, a hand-painted background in sunlit cream, pastel and gold, with flat graphic shapes and soft clean shadows.",
        },
      ],
    },
    {
      heading: "Architecture",
      note: "the city level first, then its anchors",
      packs: [
        {
          id: "lower-city",
          label: "Lower city",
          phrase:
            "the lower old city, narrow cobbled lanes that climb and turn, Baroque facades in ochre and dusty rose plaster, verdigris copper roofs.",
        },
        {
          id: "middle-districts",
          label: "Middle districts",
          phrase:
            "the middle districts, faceted facades folded like cut glass, angled bay windows framed in cut brass, a glazed arcade.",
        },
        {
          id: "upper-towers",
          label: "Upper towers",
          phrase:
            "the upper towers, cathedral towers of black basalt crowned with rings of bronze saints, giant robed saints carved into the tower faces, amber lancet windows.",
        },
        {
          id: "beyond-walls",
          label: "Beyond the walls",
          phrase:
            "beyond the walls, grey fields with one bare tree, the city's glow on the clouds behind.",
        },
      ],
    },
    {
      heading: "Exterior · Interior",
      packs: [
        {
          id: "street",
          label: "Street",
          phrase:
            "rain-wet cobbles, lanterns on curled brackets, cable-car wires across the sky.",
        },
        {
          id: "bridge",
          label: "Bridge",
          phrase:
            "the long bridge on tall pointed arches of black basalt, crystal-column flower lamps along its parapet.",
        },
        {
          id: "room-low",
          label: "Low room",
          phrase:
            "a lived-in low-city room, oxblood walls and green tile, walnut, brass and frosted glass, peonies in mismatched glass.",
        },
        {
          id: "room-high",
          label: "Tower salon",
          phrase:
            "a tower salon of black marble and gilt, crimson velvet, tall cold windows, lemon trees in brass tubs.",
        },
      ],
    },
    {
      heading: "Light",
      packs: [
        {
          id: "golden",
          label: "Golden",
          phrase:
            "golden hour, honey light low across the stone, dust in the beam, cool slate shadow.",
        },
        {
          id: "night",
          label: "Night",
          phrase: "blue-black night after rain, lanterns doubled in wet stone.",
        },
        {
          id: "fog",
          label: "Fog",
          phrase: "a cold slate day, fog between the spires, basalt against a white sky.",
        },
        {
          id: "flower-lamp",
          label: "Flower lamp",
          phrase:
            "one flower lamp, a cut tulip glowing amber inside its glass, the rest of the room falling into warm brown-black shadow.",
        },
      ],
    },
    {
      heading: "Camera",
      packs: [
        {
          id: "close",
          label: "Close",
          phrase:
            "a close-up, the face filling the frame, eyes sharp, the lamps behind as large soft discs.",
        },
        {
          id: "wide",
          label: "Wide",
          phrase:
            "a wide shot, the place is the subject, people at full length small in the middle distance.",
        },
        {
          id: "reverse",
          label: "Reverse",
          phrase: "a wide reverse angle of the same place.",
        },
      ],
    },
    {
      heading: "Wardrobe",
      note: "garment and material, never a period label",
      packs: [
        {
          id: "court",
          label: "Court",
          phrase:
            "black lacquer and gold filigree at full strength, a sculpted collar lined with crimson silk, a stiff ivory ruff.",
        },
        {
          id: "middle-class",
          label: "Middle",
          phrase:
            "tailored black with filigree at the cuffs, a high ruffled lace collar, a brass hand inlaid with gold worn like a bracelet.",
        },
        {
          id: "low-city-wardrobe",
          label: "Low city",
          phrase:
            "a lace collar mended at one point, lacquer worn matte, loose ivory linen, a black-and-oxblood wrapped skirt, crimson only as a ribbon.",
        },
        {
          id: "patrol",
          label: "Patrol",
          phrase:
            "black lacquered plate fitted like tailoring, a red coat, a helmet shaped like a closed black tulip with one brass eye.",
        },
        {
          id: "dari",
          label: "Dari",
          phrase:
            "an ivory blouse, black riding trousers laced with oxblood cord, long loose black hair half up with one red rose clip.",
        },
        {
          id: "mike",
          label: "Mike",
          phrase:
            "a slate-blue shirt, ochre trousers, a black-and-brass mechanical right arm engraved like jewellery.",
        },
      ],
    },
    {
      heading: "World markers",
      note: "one per exterior",
      packs: [
        {
          id: "cable-car",
          label: "Cable car",
          phrase:
            "a brass-and-walnut cable car hanging from a thick steel wire by a clamp on its roof.",
        },
        {
          id: "sled",
          label: "Sled",
          phrase:
            "the patrol's long low hover sled of black lacquer and brass, its hull closed like a sleigh's, a hand above the cobbles, amber light from its belly.",
        },
        {
          id: "saint",
          label: "Saint",
          phrase: "a bronze saint holding a lantern over a plinth heaped with flowers.",
        },
        {
          id: "flowers",
          label: "Flowers",
          phrase:
            "crimson ranunculus in brown paper tied with string, the one red thing in the frame.",
        },
        {
          id: "horses",
          label: "Horses",
          phrase:
            "a dray-horse flower cart beside a long lacquered motorcar on the same cobbles.",
        },
      ],
    },
    {
      heading: "Fantasy",
      note: "the magic is a steady light inside glass",
      packs: [
        {
          id: "pale",
          label: "Pale dream",
          phrase:
            "a pale dream of the same city, white fog between the spires, pearl light, one crimson stem.",
        },
        {
          id: "crimson-valley",
          label: "Crimson valley",
          phrase:
            "a field of crimson poppies under a storm sky, black monoliths, a saint's broken stone hand, one shaft of sun.",
        },
        {
          id: "sleeping-saints",
          label: "Sleeping saints",
          phrase:
            "a warm glow in the cracks at the carved saint's chest, a thin line of cold teal light set into the stone.",
        },
        {
          id: "sign-of-light",
          label: "Sign of light",
          phrase:
            "a pale sign of light hanging in the air above an old pointed doorway, thin as an etching on glass.",
        },
      ],
    },
  ];

  globalScope.SaveToGalleryPromptPackData = groups;
})(typeof globalThis !== "undefined" ? globalThis : self);
