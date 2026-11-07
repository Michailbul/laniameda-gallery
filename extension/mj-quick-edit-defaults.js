// Default system prompts for the Midjourney quick edit, one per world. They
// are a starting point: the extension's Prompt edit tab edits and saves them
// (chrome.storage.local, key quickEditPrompts); Reset brings these back.
// Written from each world's WORLD.md and LEARNINGS.md in the gallery (7 Nov 2026).

(function registerQuickEditDefaults(globalScope) {
  const WORLDS = [
    {
      key: "dear-annete",
      short: "DA",
      name: "Dear Annete",
      prompt: `DEAR ANNETE, Film look. A romantic fantasy feature drama in a Gothic-Baroque city: Victorian cyberpunk. Utopia beside decay, technology and a quiet form of magic beside horses and everyday routine, elegant people beside devastated ones, a high city of towers and a low old city, cable trams strung in the air between spires.

The cast wears ornate dark-fantasy couture: black lacquer, gold filigree, crimson silk, ivory lace and ruffs, brass mechanical limbs worn as jewellery. Describe garments by material and cut, never by a period label. Named people: Dari (long dark hair, civilian), Mike, Rhea, Viktor, Mila. Keep a name if the prompt uses one; never invent a new named character.

Places: soot-dark sandstone, Gothic needle spires with crockets and pinnacles, steep dark slate roofs, pale cream stone facades, green copper domes, gilded clock faces, crystal-column lamps, red lanterns, crimson spider lilies and poppies beyond the city walls.

Write like this:
- Concrete visual prose: subject, place, light, materials, lens. One picture only: describe the one frame being made, not the world.
- The film tail stays when it is there, e.g. "Shot on 35mm colour negative film. Organic grain, heaviest in the shadows. Soft blooming highlights, vintage spherical lenses wide open. Warm brown-black shadows, a low-contrast print."
- Never painterly words in the Film look: no "hand-painted", "brushstrokes", "painterly", "oil painting", "gilded" as a style word.
- Never a real city, landmark, river, artist or brand (no "Prague", no "Charles Bridge"): describe forms, materials, era and light instead, and change a shape so it is not a real place.
- Signs and lettering: unlit brass emblems with a shape, or out of frame. Only text the prompt asks for (a title in quotes) may appear.
- Say what is there, not what is not.`,
    },
    {
      key: "andromeda-anya",
      short: "AN",
      name: "Andromeda",
      prompt: `ANDROMEDA — ANYA. Animated science fiction about cozy family life, romance and dream exploration around Anya, her husband and their two children. Homes, bedrooms, galactic windows, Paris and Prague streets at street scale, mountain retreats and dream destinations feel warm and inhabited.

The look is chiseled painted cinematic: stylized feature-animation 3D cut into flat chamfered planes, matte painted colour, one low raking sun. Keep that rendering language when it is in the prompt.

Cast (never change these):
- Anya: adult woman, long blonde swept waves (never a bob). Spacesuit: cream suit, orange harness, clear helmet.
- Her husband: clean-shaven, short neat dark hair. Never a beard, never long hair.
- Exactly two children: a daughter of six and a little brother of three. A third child is an error.
- A big black Great Dane in hallway and home scenes.
- She is Anya, never "Ann".

Write like this:
- Stay away from the Pixar look: no soft, rounded, glossy, plastic words. Planes, chamfers, matte paint, raking light.
- No wide city panoramas: architecture at the scale of a street, a door, a courtyard or a room.
- Warm, lived-in detail: objects on tables, light on walls, family moments.
- Say what is there, not what is not.`,
    },
    {
      key: "none",
      short: "—",
      name: "No world",
      prompt: `Michael's general taste: cinematic, art-directed frames with one clear subject, a real light source and real materials. Concrete visual prose, no filler adjectives ("stunning", "beautiful", "masterpiece"), no instructions to the model.`,
    },
  ];

  globalScope.SaveToGalleryQuickEditDefaults = {
    WORLDS,
    byKey: (key) => WORLDS.find((world) => world.key === key) || WORLDS[0],
    STORAGE: { world: "quickEditWorld", model: "quickEditModel", prompts: "quickEditPrompts" },
    MODELS: [
      { key: "haiku", short: "H", name: "Haiku 5.5" },
      { key: "deepseek", short: "DS", name: "DeepSeek V4.1" },
    ],
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
