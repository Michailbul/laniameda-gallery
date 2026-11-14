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
- Stay under about 1,000 characters of prose; past 1,024 Midjourney shortens the prompt itself and drops detail.
- Parameters (--ar, --sref, --profile, --stylize …) come last; nothing descriptive after them.

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
