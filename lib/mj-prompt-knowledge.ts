// What the Midjourney quick edit knows about prompting, condensed from the
// midjourney-v8-prompt skill (~/.claude/skills/midjourney-v8-prompt).
//
// Michael, 14 Nov 2026: "rewrite it as ordinary prompt" should turn an edit
// prompt written for an attachment ("Put the woman from the attached image
// into this scene: …") into a plain text-to-image prompt that needs no edit
// mode and no attachment. The writer can only do that if it knows how the two
// kinds of prompt differ, so the knowledge lives here, next to the base rules.

export const MJ_PROMPT_KNOWLEDGE = `How Midjourney V8.2 reads a prompt:
- It weights the first words most, and the grammatical subject of the first sentence is what the picture centres on ("a woman before a field" centres her; "a field with a woman in it" centres the field).
- Shape: the main subject with its key visible traits first, then details attached to it (pose, action), then foreground, then background, then style, film and light. Finish one region of the image before moving to the next.
- Short sentences, one visual unit each. Visible language only: behaviour over emotion ("she is smiling", not "she is happy"), light as a spec (direction, colour, hardness), not a mood.
- Description, never commands: no make, create, draw, add, show, use, put, keep. Write the finished image as a scene that already exists.
- Say what is there, never what is not. Cut words that repeat what another word already says.
- One picture: only what this one frame shows.
- Stay under about 900 characters of prose; past 1,024 Midjourney shortens the prompt itself and drops detail.
- Parameters (--ar, --sref, --profile, --stylize …) come last; nothing descriptive after them.
- Every job is --v 8.2 (or no --v at all: 8.2 is the default). Never --v 8.1, --version 8.1, --v 7 or older.

Two kinds of prompt:
- An ORDINARY prompt (text to image) describes a finished picture and nothing else. Midjourney sees no file, no earlier image and no world.
- An EDIT prompt talks to a model about its inputs: Midjourney's Edit mode with attached images, or an edit model such as Seedream, Nano Banana, GPT Image, Krea or H3. Its signs: "put the woman from the attached image into this scene", "image 1", "picture 2", "<Picture 1>", "<Subject 1>", "the reference", "the same room", "this scene", "keep her face", "keep everything else", "change the background to", "replace", "turn this into", "recreate", "from the other side", "edit".

When the instruction asks for an ordinary prompt ("rewrite it as ordinary prompt", "normal prompt", "plain prompt", "text-to-image", "no edit mode", "without the attachment", "without the reference"), rewrite the whole prompt, or the whole selection, as an ordinary prompt. This is the one instruction that changes every sentence:
1. Remove every instruction to the model and every mention of an input. A lead-in such as "Put the woman from the attached image into this scene:" or "Image 1 is a frame from our film and sets the whole look:" goes completely; the prompt starts with the shot and its subject.
2. A line that asks the model to copy an input's look ("keep its exact film style, colour grade, light quality, haze, lens character, grain and level of detail") goes too: without the image it says nothing, and the profile, --sref and film tail carry the look. A concrete style word inside it moves onto the thing it describes ("its world of late-Gothic and baroque architecture" → "a late-Gothic and baroque café").
3. A person or thing that came from an attachment becomes a visible description built only from what the prompt itself says: "the woman from the attached image … her pale blue-grey eye … her long black hair" becomes "a young woman with pale blue-grey eyes and long black hair". Never invent hair, eyes, a face, age, ethnicity, garment or name the prompt does not give (the examples below are not this prompt); with nothing given, write the plain noun ("a young woman").
4. A keep line becomes a plain statement of what is kept ("keep her curls" → "her hair falls in tight curls"). "Change the background to X" becomes "behind her, X". "The same café from the reverse angle" becomes the view itself, described ("seen from beside the tall windows, looking back across the café to its entrance door"). The words "the same", "now", "unchanged", "exactly" and "as in the image" never survive.
5. A place known only from the inputs or the world ("this scene", "the same room", "the crimson field beyond the city walls") becomes what the camera sees ("a field of crimson spider lilies beyond old stone city walls").
6. Sentences written for other models go, such as "The image contains no text, letters or numbers." Style phrases such as "A live-action film still" stay.
7. Rebuild it in the shape above: shot and subject first, its details, then what is behind, then the film or style tail. Keep the tail word for word and in its place at the end; never add words to it. When the prompt has no film or style tail, the attachment was carrying the look: add the world's own film tail from the project context, word for word, if it gives one, and nothing otherwise.
8. Remove image placeholders ([[IMGn]]) that stood for attachments in the prose. Keep every parameter and its value (--ar, --sref, --profile, --stylize and the rest), except --oref, --cref, --ow and --iw, which only served the attachment: drop those with their values.
9. Keep every visible detail of the original: framing, distance, light, colours, materials. Change the grammar, never the picture.
10. Answer with the new prompt only. Its first word is the first word of the prompt, never the instruction ("Ordinary prompt:", "Rewrite as …").

Example 1.
Edit prompt: Put the woman from the attached image into this scene: an extreme close-up of her face in profile, from the lashes of her open pale blue-grey eye to her parted lips, filling the frame edge to edge, a crimson spider lily petal resting on her lower lip, a crimson silk ribbon in her long black hair. Behind her the crimson field beyond the city walls is a soft red-gold blur under a low sun. Shot on 35mm colour negative film. Organic grain, heaviest in the shadows. Soft blooming highlights, vintage spherical lenses wide open. Warm brown-black shadows, a low-contrast print.
Ordinary prompt: An extreme close-up of a young woman's face in profile, filling the frame edge to edge from the lashes of her open pale blue-grey eye to her parted lips. A crimson spider lily petal rests on her lower lip. A crimson silk ribbon is tied in her long black hair. Behind her a field of crimson spider lilies beyond old stone city walls melts into a soft red-gold blur under a low sun. Shot on 35mm colour negative film. Organic grain, heaviest in the shadows. Soft blooming highlights, vintage spherical lenses wide open. Warm brown-black shadows, a low-contrast print.

Example 2.
Edit prompt: Image 1 is a frame from our film and sets the whole look: keep its exact film style, colour grade, light quality, haze, lens character, grain and level of detail, and its world of late-Gothic and baroque architecture. The reverse angle of the same café: we now stand by the tall windows looking back into the room toward the entrance door. The same canopy of pale hanging roses and glowing globe lamps overhead, the same black lacquer chairs and tables with candles. A live-action film still, shot on 35mm colour negative film, fine grain, soft highlights, deep soft shadows. The image contains no text.
Ordinary prompt: A late-Gothic and baroque café at night, seen from beside its tall windows, looking back across the room to the entrance door. A canopy of pale hanging roses and glowing globe lamps hangs overhead. Black lacquer chairs and tables with lit candles fill the room. A live-action film still, shot on 35mm colour negative film, fine grain, soft highlights, deep soft shadows.

The other way, when the instruction asks for an edit prompt: open with the input the picture must hold ("Put the woman from image 1 into this scene:"), then describe the scene as above. Name images by number, the one that must hold first. Write the change, and add a keep line only for something that tends to drift.`;


// How the writer frames a shot like a real film, for every world, with Dear
// Annete's own addendum. Michael, 17 Nov 2026: "for location we always need
// wide angles"; for Dear Annete "about 50% like reality, 50% new, so people
// don't see 100% invention; don't overdo the details"; "the world is built on
// close-ups too"; "prioritise real cinematography for locations and scenes".
// Written with a research agent from the midjourney-v8-prompt skill and
// checked against the world rules. Every Grow move and quick edit gets it.
export const CINEMATIC_RULES = `CINEMATIC RULES (every world)
- Write each prompt as one frame from a real film: name the shot size, lens, camera height and one light.
- Shot sizes: extreme wide, wide, full shot, medium, medium close-up, close-up, insert. One per prompt.
- Lenses: 24mm or 28mm for wides, 35mm or 50mm for people in a place, 85mm or 100mm for faces and hands. Wides get deep focus, close-ups shallow depth of field. Never fisheye.
- Camera height: eye level by default, slightly low for a building, high only when the move asks.
- Light comes from a source the camera could find: a window, an open door, a candle, an oil lamp, a fire, a street lamp, low sun, overcast sky, blue dusk. Give direction and colour ("cold overcast light from the left, soft shadows"). One key source, at most one practical in shot. Never "dramatic lighting" or "magical glow".
- People look cast for a film: real faces with lines and uneven skin, natural hair, ordinary posture, grounded clothes named by material and cut (a dark wool coat, a plain grey suit, a simple black dress).
- Restraint: one subject, a few things around it, and empty space (bare wall, wet ground, sky, shadow).
- Detail budget. Wide: the place, two or three architectural features, weather, light, one strange element at most. Medium: the person, one action, two nearby things, a one-sentence background. Close-up: one face, hand or object, one material, the light, a soft background.
- Never write: intricate, ornate, highly detailed, hyper-detailed, elaborate, opulent, lavish, glittering, sparkling, gilded, filigree, jewel-encrusted, chrome, brass, crystal lamps, chandeliers of crystal, gadgets, gears, clockwork, holograms, glowing runes, stunning, masterpiece, 8k, epic. Nothing floats in the sky without a mooring or route.
- One or two signs of wear (soot, rain stains, worn steps, peeling plaster) do more than any ornament.

LOCATION RULES
- A location is always wide: establishing wide, wide reverse, corner or doorway wide, high wide, full room, full street, full courtyard. Never a tight crop.
- The place is the grammatical subject of the first sentence ("A narrow cobbled street of tall stone houses climbs toward a church").
- Camera at eye level or slightly low, a 24mm or 28mm lens, deep focus, verticals straight.
- People are small or absent: two or three distant figures at most, or a thin crowd as one soft mass.
- Multiple views of one location: fix a PLACE LINE (architecture style, materials, ground, one landmark feature) and a LIGHT LINE (source, direction, hour, weather). Copy both word for word into every view; change only the camera sentence:
  1. Establishing wide: the whole place from its open end.
  2. Reverse wide: from the far end looking back; say what that reveals.
  3. Corner or doorway wide: from inside an arch or doorway, its edge dark in frame.
  4. High wide: from an upper window or a roof, looking down across the whole place.
  5. Dusk or night: the establishing wide with a new LIGHT LINE only (blue dusk with a few warm windows, or wet lamplit night).

CLOSE-UP RULES
- The world is built on close-ups too: faces, hands on real objects, textures. One thing per close-up.
- Faces: 85mm, shallow depth of field, eyes sharp, real skin, a plain collar. The background is the source frame's place, soft, in one short clause.
- Hands: one ordinary action with one real object (a cup, a key, a letter, a candle). Name its material and wear.
- Textures: one surface (wet stone, cracked leather, wax on iron, rain on glass) in the frame's light.
- A close-up stays in its world through the same light line, the same palette words and one material from the wide. Never pile in props to prove the world.

DEAR ANNETE ADDENDUM
- Half real, half new. Build on a real old European Gothic town (the kind in Prague, Bruges, Kraków, Edinburgh, Gent), then add one or two quiet strange elements. A viewer believes the place exists until they notice the strange thing.
- Those city names are for you only. Never write a real city, landmark or river into a prompt.
- Strange elements: a building far too tall for its street, a cathedral fused with an enormous worn stone figure, an airship moored at a spire, a cable car on a wire between towers, a thin line of cold light in old stone, a steady pale light in a plain glass jar.
- Cyberpunk is a trace, about one part in five: one cold neon tube or shape without letters, a cable, a modern-looking lamp, a small screen in an old frame. It never dominates.
- Light: candles, oil lamps, plain iron lamps, firelight, daylight, overcast, dusk.
- People are real: dark coats, suits, simple dresses, shawls. No armour, crowns, knights, costume fantasy or creatures unless the art director asks.
- Vocabulary: late Gothic, Brick Gothic, lancet windows, pointed arches, stepped gables, flying buttresses, pinnacles, ribbed vaults, steep slate roofs, arcades, narrow lanes, cobbles, soot-dark sandstone, pale limestone, dark red brick, lead-glass windows, wrought iron, wet stone, fog, drizzle, low cloud, blue dusk, candlelit gloom, cold overcast morning.
- Never write: brass, bronze, copper, mechanical hand or arm, prosthetic, crystal lamp, crystal chandelier, clock, clockwork, cog, gear, steampunk, filigree, gilded, ornate, intricate, glittering, neon street, hologram, glass skyscraper.

EXAMPLE PROMPTS (Dear Annete, words only)
1. Location wide: A narrow cobbled lane of tall soot-dark sandstone houses with stepped gables climbs toward a late Gothic church tower. Wet cobbles, shuttered windows, a single cold neon tube above one low doorway. Thin fog at roof height. Cold overcast morning light. A wide photograph from eye level, 24mm lens, deep focus.
2. Location wide, reverse: From the top of a cobbled lane, looking back down between soot-dark sandstone houses with stepped gables toward a low town of steep slate roofs. Far beyond the roofs, an enormous cathedral rises, its tower fused with a colossal worn stone figure. Cold overcast morning light. A wide photograph from eye level, 24mm lens, deep focus.
3. Close-up: A close-up of a woman in her thirties with dark hair pinned back and tired grey eyes, the collar of a dark wool coat turned up. Her skin shows faint lines and a cold flush. Behind her, a soft blur of wet stone and one warm window. Overcast light from the left. 85mm lens, shallow depth of field.
4. Close-up, hands: An insert of an old man's hands holding a lit candle stub in a plain iron holder on a worn stone windowsill. Wax runs over the iron. Rain beads on the lead-glass window behind, soft and out of focus. Warm candlelight from below, deep shadow around it. 100mm lens, shallow depth of field.
5. Scene: A young man in a plain dark suit waits under a pointed stone arcade at blue dusk, hands in his pockets, looking across the empty square. Behind him, narrow Gothic houses with a few warm windows. One thin cable sags between two roofs. Light from a single iron street lamp. A medium shot, eye level, 35mm lens.
6. Scene: In a vaulted stone kitchen, an older woman in a simple black dress and grey shawl pours tea at a scrubbed wooden table. A girl in a dark coat sits across from her. A steady pale light glows in a plain glass jar on the shelf. Daylight from one high window. A full shot, eye level, 35mm lens.

CHECKLIST (run on every prompt before returning it)
1. One shot size, a lens, a camera height, one motivated light with a direction?
2. A location is wide, the place is the subject, people small or absent?
3. One subject, inside the detail budget for its size?
4. Every detail readable at its distance?
5. Real faces, grounded clothes named by material and cut?
6. No never-word (ornate, intricate, highly detailed, brass, crystal lamps, clocks, glitter, gadgets)?
7. Dear Annete: real old-town Gothic first, one or two strange elements, the cyberpunk trace small?
8. No character name, real city, landmark or coined term?
9. In a multi-view set, place line and light line identical in every view?
10. Plain visual prose: no negatives, commands or parameters, under 900 characters?`;

// Only the part for every world (no Dear Annete addendum or examples), for
// writers that work outside Dear Annete.
export const CINEMATIC_RULES_GENERAL = CINEMATIC_RULES.split("DEAR ANNETE ADDENDUM")[0].trim();

// The Dear Annete addendum alone.
export const DEAR_ANNETE_CINEMATIC = (() => {
  const start = CINEMATIC_RULES.indexOf("DEAR ANNETE ADDENDUM");
  const end = CINEMATIC_RULES.indexOf("EXAMPLE PROMPTS");
  return start < 0 ? "" : CINEMATIC_RULES.slice(start, end < 0 ? undefined : end).trim();
})();
