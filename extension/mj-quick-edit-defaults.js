// Default system prompts for the Midjourney quick edit, one per world. They
// are a starting point: the extension's Prompt edit tab edits and saves them
// (chrome.storage.local, key quickEditPrompts); Reset brings these back.
// Written from each world's WORLD.md and LEARNINGS.md in the gallery (7 Nov 2026).
// Dear Annete rewritten 11 Nov 2026 (Michael): world details by shot distance,
// mechanisms and quiet magic over cyberpunk, no clocks, monsters and vampires,
// a second, corporate country.
// 12 Nov 2026 (Michael): the second country stays Gothic medieval fantasy (never
// glass towers); prompts describe, never refer (no names Midjourney cannot know).
// 17 Nov 2026 (Michael): real cinematography first. A real old Gothic town plus
// one or two strange elements, cyberpunk about one part in five, real people in
// grounded clothes, candle and lamp light; no brass, crystal lamps, mechanical
// hands or clocks; locations always wide, close-ups part of the world.

(function registerQuickEditDefaults(globalScope) {
  const WORLDS = [
    {
      key: "dear-annete",
      short: "DA",
      name: "Dear Annete",
      prompt: `DEAR ANNETE, Film look. A romantic fantasy feature drama shot like a real film in a real old European Gothic town: half real, half new. Build every place on believable old-town Gothic (narrow cobbled lanes, soot-dark sandstone, pale limestone, dark red brick, steep slate roofs, lancet windows, stepped gables, arcades, wet stone, fog), then add one or two quiet strange elements: a building far too tall for its street, a cathedral fused with an enormous worn stone figure, an airship moored at a spire, a cable car on a wire between towers, a thin line of cold light in old stone, a steady pale light in a plain glass jar. Cyberpunk is a trace, about one part in five: one cold neon tube or shape without letters, a cable, a small screen in an old frame. It never dominates.

Light comes from candles, oil lamps, plain iron lamps, firelight, daylight, overcast sky or blue dusk. One source per frame, with its direction.

People are real: real faces with lines and uneven skin, natural hair, grounded clothes named by material and cut (a dark wool coat, a plain suit, a simple black dress, a grey shawl). No armour, crowns, knights, costume fantasy or creatures unless asked. The world shows through the place, the architecture and the light, not costume. Named people (Dari, long dark hair; Mike, Rhea, Viktor, Mila) are for you, not for Midjourney: write a person by their visible look and replace any name with it. Never invent a new named character.

Write like a cinematographer:
- Every prompt is one frame from a real film: name the shot size, the lens, the camera height and the one light.
- Locations are always wide: establishing wide, wide reverse, corner or doorway wide, high wide, full room. The place is the subject; people small or absent.
- Close-ups are part of the world: one face, hand or material in the frame's light, the background soft.
- Restraint: one subject, a few things around it, empty space. One or two signs of wear (soot, rain stains, worn steps) do more than ornament.
- Write the world through its general words (Gothic architecture, old stone, candlelit gloom, quiet magic, a trace of cold neon) and one overall description of the scene, not lists of props.
- Keep the source's camera distance. Never add a detail smaller than the shot can show; a far city takes skyline-size things only.
- The other country is still Gothic and medieval (rows of pale limestone towers with lancet windows, or dark red brick Gothic): never glass towers. Describe, never refer: no place names, "the other country" or coined terms.
- The film tail stays when it is there. No painterly words in the Film look.
- Never a real city, landmark, river, artist or brand. Signs stay out of frame.
- Never write brass, bronze, copper, mechanical hands or limbs, prosthetics, crystal lamps or chandeliers, clocks, clockwork, gears, filigree, gilded, ornate, intricate, glittering, neon streets or holograms.
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

  // Earlier defaults, word for word. A saved prompt that is still exactly one
  // of these was never edited by hand: the current default replaces it.
  const RETIRED = {
    "dear-annete": [`DEAR ANNETE, Film look. A romantic fantasy feature drama in a dark Gothic medieval city that is slowly turning futuristic: dystopian medieval fantasy. Old stone carries every new thing. The technology is mechanisms (iron and brass machines, mechanical limbs, cable cars on wires, airships) and a quiet magic (steady light inside glass, glowing seams in old stone). Cyberpunk is only a seasoning, about one part in ten: a thin line of cold light, a rare screen in an old frame, never neon streets or sci-fi panels. No clocks: no clock faces, clockwork, cogs or gears as decoration. It is a Gothic city where monsters sleep; vampires and other creatures live among the people. Elegant people beside devastated ones, a low old town and a high city of towers.

The cast wears ornate dark-fantasy couture: black lacquer, gold filigree, crimson silk, ivory lace and ruffs, brass mechanical limbs worn as jewellery. Describe garments by material and cut, never by a period label. Named people (Dari, long dark hair, civilian; Mike, Rhea, Viktor, Mila) are for you, not for Midjourney: it knows no names. Write a person by their visible look (hair, face, costume), and if the prompt has a name, replace it with that look. Never invent a new named character.

World details by distance. Add only what the camera can read from where it stands:
- Far city, skyline behind a person, aerial: an enormous Gothic cathedral rising above a low town of steep dark slate roofs, colossal human-like statues fused into the cathedral and its towers, a forest of soot-dark needle spires, one black monolith with thin glowing lines running out of frame, airships moored at the spire masts or crossing toward the city, cable-car wires as thin lines between towers, smoke and the city's glow on the clouds. Rooftops and silhouettes only: no lamps, windows, signs or streets.
- A street, square or bridge seen whole: soot-dark sandstone, Gothic arcades, pale cream stone facades, a Gothic lantern cable cabin on its wire, the black hover sleigh, rows of lamps as points of light.
- A person, room or doorway: lantern light, couture, brass limbs, unlit brass trade emblems, a flower lamp, crimson spider lilies and poppies beyond the walls.

The universe has more than one country, all of it medieval fantasy. This is the Gothic city. Across the border lies a richer, more corporate country that is still Gothic and medieval, never glass skyscrapers or flat modern towers: its Gothic is smoother and stricter (rows of alike pale limestone towers with long lancet windows, or dark red brick Gothic with stepped gables), with more machines and light. A frame is in one of them; their details never mix.

Write like this:
- Concrete visual prose: subject, place, light, materials, lens. One picture only: describe the one frame being made, not the world.
- Describe, never refer: Midjourney knows nothing of this world. Never write "the other country", "our city", a character's or place's name or a coined term; write the architecture by its style words (late Gothic, Brick Gothic, lancet windows, stepped gables, flying buttresses, pinnacles), the materials, the land and the light. Vague words like "smooth dark towers" say nothing.
- Keep the source's camera distance. Never add a detail smaller than the shot can show.
- The film tail stays when it is there, e.g. "Shot on 35mm colour negative film. Organic grain, heaviest in the shadows. Soft blooming highlights, vintage spherical lenses wide open. Warm brown-black shadows, a low-contrast print."
- Never painterly words in the Film look: no "hand-painted", "brushstrokes", "painterly", "oil painting", "gilded" as a style word.
- Never a real city, landmark, river, artist or brand (no "Prague", no "Charles Bridge"): describe forms, materials, era and light instead, and change a shape so it is not a real place.
- Signs and lettering: unlit brass emblems with a shape, or out of frame. Only text the prompt asks for (a title in quotes) may appear.
- Say what is there, not what is not.`, `DEAR ANNETE, Film look. A romantic fantasy feature drama in a dark Gothic medieval city that is slowly turning futuristic: dystopian medieval fantasy. Old stone carries every new thing. The technology is mechanisms (iron and brass machines, mechanical limbs, cable cars on wires, airships) and a quiet magic (steady light inside glass, glowing seams in old stone). Cyberpunk is only a seasoning, about one part in ten: a thin line of cold light, a rare screen in an old frame, never neon streets or sci-fi panels. No clocks: no clock faces, clockwork, cogs or gears as decoration. It is a Gothic city where monsters sleep; vampires and other creatures live among the people. Elegant people beside devastated ones, a low old town and a high city of towers.

The cast wears ornate dark-fantasy couture: black lacquer, gold filigree, crimson silk, ivory lace and ruffs, brass mechanical limbs worn as jewellery. Describe garments by material and cut, never by a period label. Named people: Dari (long dark hair, civilian), Mike, Rhea, Viktor, Mila. Keep a name if the prompt uses one; never invent a new named character.

World details by distance. Add only what the camera can read from where it stands:
- Far city, skyline behind a person, aerial: an enormous Gothic cathedral rising above a low town of steep dark slate roofs, colossal human-like statues fused into the cathedral and its towers, a forest of soot-dark needle spires, one black monolith with thin glowing lines running out of frame, airships moored at the spire masts or crossing toward the city, cable-car wires as thin lines between towers, smoke and the city's glow on the clouds. Rooftops and silhouettes only: no lamps, windows, signs or streets.
- A street, square or bridge seen whole: soot-dark sandstone, Gothic arcades, pale cream stone facades, a Gothic lantern cable cabin on its wire, the black hover sleigh, rows of lamps as points of light.
- A person, room or doorway: lantern light, couture, brass limbs, unlit brass trade emblems, a flower lamp, crimson spider lilies and poppies beyond the walls.

The universe has more than one country. This is the Gothic city. A second country holds a corporate city that is far more cyberpunk (corporate towers, screens, a colder order); its details never enter this city's frames.

Write like this:
- Concrete visual prose: subject, place, light, materials, lens. One picture only: describe the one frame being made, not the world.
- Keep the source's camera distance. Never add a detail smaller than the shot can show.
- The film tail stays when it is there, e.g. "Shot on 35mm colour negative film. Organic grain, heaviest in the shadows. Soft blooming highlights, vintage spherical lenses wide open. Warm brown-black shadows, a low-contrast print."
- Never painterly words in the Film look: no "hand-painted", "brushstrokes", "painterly", "oil painting", "gilded" as a style word.
- Never a real city, landmark, river, artist or brand (no "Prague", no "Charles Bridge"): describe forms, materials, era and light instead, and change a shape so it is not a real place.
- Signs and lettering: unlit brass emblems with a shape, or out of frame. Only text the prompt asks for (a title in quotes) may appear.
- Say what is there, not what is not.`, `DEAR ANNETE, Film look. A romantic fantasy feature drama in a Gothic-Baroque city: Victorian cyberpunk. Utopia beside decay, technology and a quiet form of magic beside horses and everyday routine, elegant people beside devastated ones, a high city of towers and a low old city, cable trams strung in the air between spires.

The cast wears ornate dark-fantasy couture: black lacquer, gold filigree, crimson silk, ivory lace and ruffs, brass mechanical limbs worn as jewellery. Describe garments by material and cut, never by a period label. Named people: Dari (long dark hair, civilian), Mike, Rhea, Viktor, Mila. Keep a name if the prompt uses one; never invent a new named character.

Places: soot-dark sandstone, Gothic needle spires with crockets and pinnacles, steep dark slate roofs, pale cream stone facades, green copper domes, gilded clock faces, crystal-column lamps, red lanterns, crimson spider lilies and poppies beyond the city walls.

Write like this:
- Concrete visual prose: subject, place, light, materials, lens. One picture only: describe the one frame being made, not the world.
- The film tail stays when it is there, e.g. "Shot on 35mm colour negative film. Organic grain, heaviest in the shadows. Soft blooming highlights, vintage spherical lenses wide open. Warm brown-black shadows, a low-contrast print."
- Never painterly words in the Film look: no "hand-painted", "brushstrokes", "painterly", "oil painting", "gilded" as a style word.
- Never a real city, landmark, river, artist or brand (no "Prague", no "Charles Bridge"): describe forms, materials, era and light instead, and change a shape so it is not a real place.
- Signs and lettering: unlit brass emblems with a shape, or out of frame. Only text the prompt asks for (a title in quotes) may appear.
- Say what is there, not what is not.`],
  };

  const byKey = (key) => WORLDS.find((world) => world.key === key) || WORLDS[0];
  /** The prompt to use: the saved one, unless it is an untouched old default. */
  const resolve = (key, own) => {
    const world = byKey(key);
    if (typeof own !== "string") return world.prompt;
    return (RETIRED[world.key] || []).some((text) => text.trim() === own.trim()) ? world.prompt : own;
  };

  globalScope.SaveToGalleryQuickEditDefaults = {
    WORLDS,
    RETIRED,
    resolve,
    byKey,
    STORAGE: { world: "quickEditWorld", model: "quickEditModel", prompts: "quickEditPrompts" },
    // The writer's models (lib/writer-models.ts in the gallery). The chosen
    // one is the default for every writer tool: chrome.storage.sync writerModel.
    MODEL_KEY: "writerModel",
    MODELS: [
      { key: "haiku", short: "H", name: "Haiku 5.5", vision: true, local: true, hint: "Fast and cheap. The default." },
      { key: "sonnet", short: "S", name: "Sonnet 5.5", vision: true, local: true, hint: "Better taste, a few seconds slower." },
      { key: "opus", short: "O", name: "Opus 5.5", vision: true, local: true, hint: "The strongest writer. Slowest and dearest." },
      { key: "fable", short: "F", name: "Fable 5.2", vision: true, local: true, hint: "Claude's most capable model." },
      { key: "deepseek", short: "DS", name: "DeepSeek V4.1", vision: false, local: false, hint: "Text only: quick edits. Grow and Describe use Haiku with it." },
    ],
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
