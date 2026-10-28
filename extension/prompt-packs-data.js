// Dear Annete prompt packs. One pack is one breath: a short phrase that goes
// into the Midjourney prompt box verbatim. Edit phrases here, not in the UI.
(function registerPromptPackData(globalScope) {
  "use strict";

  const groups = [
    {
      heading: "Style",
      packs: [
        {
          id: "film",
          label: "Film",
          phrase:
            "Cinematic high-budget feature film still, 35mm, shallow focus, one practical key.",
        },
        { id: "3d", label: "3D", phrase: "Cinematic 3D animation frame." },
      ],
    },
    {
      heading: "Where",
      packs: [
        {
          id: "lower-city",
          label: "Lower city",
          phrase:
            "narrow cobbled lanes, ochre and dusty-rose plaster, verdigris copper roofs.",
        },
        {
          id: "upper-towers",
          label: "Upper towers",
          phrase:
            "black basalt cathedral towers, bronze sunburst crowns, amber lancet windows.",
        },
        {
          id: "exterior",
          label: "Exterior",
          phrase: "rain-wet cobbles, crystal-column lamps, cables across the sky.",
        },
        {
          id: "interior",
          label: "Interior",
          phrase:
            "lived-in rooms, worn velvet, herringbone parquet, a cold cup, flowers in mismatched glass.",
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
            "low warm sun, dust in the beam, amber skin against cool slate shadow.",
        },
        {
          id: "night",
          label: "Night",
          phrase: "wet stone, warm lamps doubled in the street, blue-black air.",
        },
        {
          id: "lamp",
          label: "Lamp",
          phrase:
            "one crystal-column lamp, faceted like cut glass, the rest of the room falling off.",
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
            "close framing, razor-sharp eyes, background lights as large soft discs.",
        },
        {
          id: "wide",
          label: "Wide",
          phrase:
            "the place is the subject, people small in the middle distance, 16:9.",
        },
      ],
    },
    {
      heading: "Wardrobe",
      packs: [
        {
          id: "court",
          label: "Court",
          phrase: "black lacquer, gold filigree, a high ruff, crimson silk.",
        },
        {
          id: "dari",
          label: "Dari",
          phrase:
            "ivory satin blouse, high-waisted black leather trousers laced with oxblood cord, one deep-red rose clip.",
        },
        {
          id: "mike",
          label: "Mike",
          phrase:
            "slate-blue tailcoat, brass buttons, ivory cravat, a brass-and-black mechanical right arm.",
        },
      ],
    },
    {
      heading: "World markers",
      note: "one each",
      packs: [
        {
          id: "cable-car",
          label: "Cable car",
          phrase: "a brass-and-walnut cabin hanging from a wire.",
        },
        {
          id: "sled",
          label: "Sled",
          phrase:
            "a long low hover sled of black lacquer and brass, a hand's width above the cobbles.",
        },
        {
          id: "bridge",
          label: "Bridge",
          phrase:
            "the long bridge on tall pointed arches of black basalt, crystal-column lamps holding cut flowers.",
        },
        {
          id: "merge",
          label: "Merge",
          phrase: "one old stone thing and one brass machine in the same frame.",
        },
      ],
    },
    {
      heading: "Strange, still this world",
      packs: [
        {
          id: "pale",
          label: "Pale",
          phrase: "a pale dream of the same city, fog, almost no crimson.",
        },
        {
          id: "crimson-valley",
          label: "Crimson valley",
          phrase: "storm light, crimson flowers against teal-black.",
        },
      ],
    },
  ];

  globalScope.SaveToGalleryPromptPackData = groups;
})(typeof globalThis !== "undefined" ? globalThis : self);
