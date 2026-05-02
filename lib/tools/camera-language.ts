export type CameraMoveCategory =
  | "push-pull"
  | "orbit"
  | "vertical"
  | "lateral"
  | "lens-focus"
  | "creative";

export type CameraMoveEmotion =
  | "attention"
  | "intimacy"
  | "shock"
  | "isolation"
  | "tension"
  | "showcase"
  | "power"
  | "scale"
  | "defeat"
  | "companionship"
  | "immersion"
  | "clarity"
  | "transition"
  | "conversation"
  | "action";

export type CameraMove = {
  slug: string;
  category: CameraMoveCategory;
  term: string;
  aliases?: string[];
  meaning: string;
  useFor: string;
  prompt: string;
  emotion: CameraMoveEmotion[];
  motion: "in" | "out" | "circle" | "up" | "down" | "side" | "focus" | "dynamic";
  aiNote: string;
};

export const cameraMoveCategories: Array<{
  id: CameraMoveCategory;
  label: string;
  principle: string;
}> = [
  {
    id: "push-pull",
    label: "Push / Pull",
    principle: "Move in for intimacy or intensity. Move out for distance and context.",
  },
  {
    id: "orbit",
    label: "Orbit",
    principle: "Circle the subject when the audience needs to inspect identity, costume, scale, or transformation.",
  },
  {
    id: "vertical",
    label: "Vertical",
    principle: "Rise for power and scale. Descend for intimacy, arrival, or defeat.",
  },
  {
    id: "lateral",
    label: "Lateral",
    principle: "Move with the subject when the shot needs companionship, travel, or pursuit.",
  },
  {
    id: "lens-focus",
    label: "Lens / Focus",
    principle: "Change attention without moving the camera body.",
  },
  {
    id: "creative",
    label: "Creative",
    principle: "Use these for high-energy beats, transitions, and stylized moments.",
  },
];

export const cameraMoves: CameraMove[] = [
  {
    slug: "slow-dolly-in",
    category: "push-pull",
    term: "Slow dolly in",
    meaning: "The camera slowly moves toward the subject.",
    useFor: "Realization, intimacy, a moment the viewer must notice.",
    prompt: "slow dolly in toward the subject's face",
    emotion: ["attention", "intimacy"],
    motion: "in",
    aiNote: "Use one clear destination. Face, hands, object, wound, screen.",
  },
  {
    slug: "fast-dolly-in",
    category: "push-pull",
    term: "Fast dolly in",
    aliases: ["Rush"],
    meaning: "A rapid push toward the subject.",
    useFor: "Shock, urgency, action impact, jump-scare energy.",
    prompt: "fast dolly in, rushing toward the subject",
    emotion: ["shock", "attention", "action"],
    motion: "in",
    aiNote: "Works best when only the camera moves and the subject holds one readable action.",
  },
  {
    slug: "slow-dolly-out",
    category: "push-pull",
    term: "Slow dolly out",
    meaning: "The camera slowly moves backward.",
    useFor: "Isolation, emotional distance, revealing the space around the subject.",
    prompt: "slow dolly out, revealing the surrounding space",
    emotion: ["isolation"],
    motion: "out",
    aiNote: "Name what appears in the reveal: empty room, battlefield, crowd, wreckage.",
  },
  {
    slug: "dolly-zoom",
    category: "push-pull",
    term: "Dolly zoom",
    aliases: ["Vertigo effect"],
    meaning: "The camera moves back while the lens zooms in.",
    useFor: "Dramatic realization, panic, physical tension.",
    prompt: "dolly zoom, background warps around the subject",
    emotion: ["tension", "shock"],
    motion: "dynamic",
    aiNote: "Use rarely. The effect loses power when every shot does it.",
  },
  {
    slug: "extreme-macro-zoom",
    category: "push-pull",
    term: "Extreme macro zoom",
    meaning: "The camera pushes into microscopic surface detail.",
    useFor: "Obsession, texture, skin, material detail, forensic attention.",
    prompt: "extreme macro zoom into skin texture, pores, and tiny surface details",
    emotion: ["intimacy", "attention"],
    motion: "in",
    aiNote: "Specify the surface: skin, carbon fiber, glass, fabric, wet asphalt.",
  },
  {
    slug: "orbit-180",
    category: "orbit",
    term: "180 orbit",
    meaning: "The camera circles halfway around the subject.",
    useFor: "Character introduction, costume reveal, product or vehicle showcase.",
    prompt: "camera orbits 180 degrees around the subject in a smooth half-circle",
    emotion: ["showcase"],
    motion: "circle",
    aiNote: "Good default for identity reveal because it shows two sides without chaos.",
  },
  {
    slug: "orbit-360",
    category: "orbit",
    term: "360 orbit",
    meaning: "The camera makes a full circle around the subject.",
    useFor: "Power-up, transformation, hero reveal.",
    prompt: "fast 360-degree orbit around the subject",
    emotion: ["power", "showcase", "action"],
    motion: "circle",
    aiNote: "Keep the subject centered. Extra subject motion often breaks the shot.",
  },
  {
    slug: "slow-cinematic-arc",
    category: "orbit",
    term: "Slow cinematic arc",
    meaning: "A gentle curved move around the subject.",
    useFor: "Beauty shot, contemplation, profile reveal.",
    prompt: "slow cinematic arc around the subject, gradually revealing the profile",
    emotion: ["showcase", "intimacy"],
    motion: "circle",
    aiNote: "Best for quiet shots. Use soft camera speed and a clear background.",
  },
  {
    slug: "dutch-orbit",
    category: "orbit",
    term: "Dutch orbit",
    meaning: "An orbit where the camera is tilted on its axis.",
    useFor: "Psychological tension, violence, instability.",
    prompt: "Dutch orbit, camera tilted on its axis while circling the subject",
    emotion: ["tension"],
    motion: "circle",
    aiNote: "Use for one beat. Too much tilt reads as accidental generation drift.",
  },
  {
    slug: "crane-up",
    category: "vertical",
    term: "Crane up",
    aliases: ["High-angle reveal"],
    meaning: "The camera rises vertically.",
    useFor: "Opening frame, landscape reveal, scale.",
    prompt: "crane up, camera rises vertically to reveal the landscape",
    emotion: ["scale", "power"],
    motion: "up",
    aiNote: "For control, give the model a start frame and end frame.",
  },
  {
    slug: "crane-down",
    category: "vertical",
    term: "Crane down",
    aliases: ["Descent"],
    meaning: "The camera descends vertically toward the subject.",
    useFor: "Epic entrance, arrival, a character entering their world.",
    prompt: "crane down toward the subject, descending into the scene",
    emotion: ["power", "scale"],
    motion: "down",
    aiNote: "Name the landing point so the descent does not drift.",
  },
  {
    slug: "pedestal-up",
    category: "vertical",
    term: "Pedestal up",
    meaning: "The entire camera body rises from low level to eye level.",
    useFor: "Revelation, power shift, a character standing up.",
    prompt: "pedestal up from waist level to eye level",
    emotion: ["power"],
    motion: "up",
    aiNote: "Different from tilt up: the camera body moves, not just the lens angle.",
  },
  {
    slug: "pedestal-down",
    category: "vertical",
    term: "Pedestal down",
    meaning: "The entire camera body lowers from eye level toward the ground.",
    useFor: "Defeat, collapse, vulnerability.",
    prompt: "pedestal down from eye level toward the ground",
    emotion: ["defeat", "intimacy"],
    motion: "down",
    aiNote: "Use when the story beat is emotional, not just informational.",
  },
  {
    slug: "tilt-up",
    category: "vertical",
    term: "Tilt up",
    meaning: "The camera pivots upward from feet to face.",
    useFor: "Presence, power, full character reveal.",
    prompt: "tilt up from the subject's feet to their face",
    emotion: ["power", "showcase"],
    motion: "up",
    aiNote: "Mention the start and end framing: boots to face, wheel to badge, street to skyline.",
  },
  {
    slug: "lateral-track",
    category: "lateral",
    term: "Lateral track",
    meaning: "The camera slides sideways across the scene.",
    useFor: "Elegant environment reveal, establishing a space.",
    prompt: "lateral tracking shot moving left to right across the scene",
    emotion: ["showcase"],
    motion: "side",
    aiNote: "Works well for interiors, streets, and product lines.",
  },
  {
    slug: "side-tracking",
    category: "lateral",
    term: "Side tracking",
    aliases: ["Parallel"],
    meaning: "The camera moves sideways with the subject at the same speed.",
    useFor: "Walking with a character, profile motion, companionship.",
    prompt: "side tracking shot, camera moves parallel with the walking subject",
    emotion: ["companionship"],
    motion: "side",
    aiNote: "Match camera speed to subject speed to avoid a floaty AI look.",
  },
  {
    slug: "leading-shot",
    category: "lateral",
    term: "Leading shot",
    aliases: ["Backward tracking"],
    meaning: "The subject walks toward camera while the camera moves backward.",
    useFor: "Emotional approach, readable face, forward momentum.",
    prompt: "backward tracking shot, subject walks toward camera as camera retreats",
    emotion: ["intimacy", "companionship"],
    motion: "out",
    aiNote: "Give the subject one walking direction and keep the face readable.",
  },
  {
    slug: "following-shot",
    category: "lateral",
    term: "Following shot",
    aliases: ["Tracking"],
    meaning: "The camera follows the subject from behind.",
    useFor: "Immersion, chase, entering the subject's world.",
    prompt: "following tracking shot from behind the subject",
    emotion: ["immersion", "action"],
    motion: "in",
    aiNote: "Strong for sci-fi corridors, street walks, forest paths, and car follow shots.",
  },
  {
    slug: "optical-zoom-in",
    category: "lens-focus",
    term: "Smooth optical zoom in",
    meaning: "The lens zooms in while the camera body stays still.",
    useFor: "Slow tension and attention without physical camera movement.",
    prompt: "smooth optical zoom in toward the subject",
    emotion: ["tension", "attention"],
    motion: "focus",
    aiNote: "Less intimate than a dolly because the camera does not enter the space.",
  },
  {
    slug: "optical-zoom-out",
    category: "lens-focus",
    term: "Smooth optical zoom out",
    meaning: "The lens pulls wider while the camera body stays still.",
    useFor: "Distance, disconnection, revealing surroundings.",
    prompt: "smooth optical zoom out, revealing the surroundings",
    emotion: ["isolation", "scale"],
    motion: "focus",
    aiNote: "Use when you want the viewer to detach from the subject.",
  },
  {
    slug: "snap-zoom",
    category: "lens-focus",
    term: "Snap zoom",
    aliases: ["Crash zoom"],
    meaning: "A rapid lens zoom toward the subject.",
    useFor: "Sudden emphasis, dramatic tension, comedy beat.",
    prompt: "snap zoom, crash zoom rapidly into the subject",
    emotion: ["shock", "attention"],
    motion: "focus",
    aiNote: "It is a lens action, not a dolly. Say optical or zoom if the model confuses it.",
  },
  {
    slug: "reveal-from-blur",
    category: "lens-focus",
    term: "Reveal from blur",
    meaning: "The shot starts out of focus, then sharpens.",
    useFor: "Waking up, memory return, regaining clarity.",
    prompt: "shot begins fully blurred, then slowly sharpens into focus",
    emotion: ["clarity"],
    motion: "focus",
    aiNote: "Define what becomes clear: face, skyline, weapon, logo, screen.",
  },
  {
    slug: "rack-focus",
    category: "lens-focus",
    term: "Rack focus",
    meaning: "Focus shifts between foreground and background.",
    useFor: "Showing what a character notices without cutting.",
    prompt: "rack focus from the subject to the background",
    emotion: ["attention", "clarity"],
    motion: "focus",
    aiNote: "Name both focus targets. AI handles it better with two anchors.",
  },
  {
    slug: "drone-flyover",
    category: "creative",
    term: "Drone flyover",
    meaning: "High-altitude camera flight over a location.",
    useFor: "Big environment, opening shot, battlefield or city scale.",
    prompt: "drone flyover above the landscape",
    emotion: ["scale"],
    motion: "dynamic",
    aiNote: "Name terrain and flight direction: over rooftops, toward mountains, across desert.",
  },
  {
    slug: "over-the-shoulder",
    category: "creative",
    term: "Over the shoulder",
    meaning: "Camera sits behind one character, looking toward another.",
    useFor: "Conversation, confrontation, connection.",
    prompt: "over-the-shoulder shot from behind one character toward the other",
    emotion: ["conversation", "tension"],
    motion: "focus",
    aiNote: "Mention which shoulder if blocking matters.",
  },
  {
    slug: "handheld-dynamic",
    category: "creative",
    term: "Handheld dynamic",
    meaning: "Natural human camera shake and uneven movement.",
    useFor: "Raw scenes, action, documentary feeling.",
    prompt: "handheld dynamic camera with natural shake",
    emotion: ["action", "tension", "immersion"],
    motion: "dynamic",
    aiNote: "Pair with one physical event: running, impact, argument, explosion.",
  },
  {
    slug: "whip-pan",
    category: "creative",
    term: "Whip pan",
    meaning: "The camera whips sideways with heavy motion blur.",
    useFor: "Transition, sudden reveal, fast energy.",
    prompt: "whip pan violently to the side with strong motion blur",
    emotion: ["transition", "shock", "action"],
    motion: "dynamic",
    aiNote: "Use as a transition bridge between two clear visual states.",
  },
  {
    slug: "barrel-roll",
    category: "creative",
    term: "Barrel shot",
    aliases: ["Barrel roll"],
    meaning: "The camera rotates on its axis.",
    useFor: "Disorientation, chaos, stylized danger.",
    prompt: "barrel roll shot, camera rotates on its axis",
    emotion: ["tension", "action"],
    motion: "dynamic",
    aiNote: "Good for aircraft, falling, crashes, dream logic, and chaos beats.",
  },
  {
    slug: "pov",
    category: "creative",
    term: "POV",
    meaning: "First-person camera from the character's eyes.",
    useFor: "Maximum immersion and embodied action.",
    prompt: "POV shot from the character's eyes",
    emotion: ["immersion", "action"],
    motion: "dynamic",
    aiNote: "Describe hands, breath, head movement, and what the character sees.",
  },
  {
    slug: "bullet-time",
    category: "creative",
    term: "Bullet time",
    aliases: ["Matrix effect"],
    meaning: "Time slows while camera orbits the subject.",
    useFor: "Frozen action, impact moment, stylized drama.",
    prompt: "bullet time, time slows dramatically as camera orbits the subject",
    emotion: ["action", "showcase", "tension"],
    motion: "circle",
    aiNote: "Best with a clear frozen event: glass, rain, debris, sparks, fabric.",
  },
];

export const cameraMoveThumbnailPrompts: Record<string, string> = {
  "slow-dolly-in": "Create an image of: a solitary actor in a rain-slick subway platform at night, framed as the start frame for a slow dolly in. Style: cinematic film still, 16:9, 35mm anamorphic, shallow depth of field. Composition: medium close-up with the face centered, empty platform receding behind them, eyes catching a small strip of cold overhead light. Lighting: cool fluorescent top light, soft coral reflection from a train signal on wet tiles. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "fast-dolly-in": "Create an image of: a startled detective turning toward camera in a narrow apartment hallway, framed as the start frame for a fast dolly in. Style: cinematic thriller still, 16:9, 28mm lens, tense close perspective. Composition: subject centered with one hand on the wall, door behind them half open, background compressed by shadow. Lighting: hard practical lamp from the left, thin blue moonlight through the doorway. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "slow-dolly-out": "Create an image of: a lone figure seated at a small table inside a huge abandoned theater, framed as the start frame for a slow dolly out. Style: cinematic drama still, 16:9, wide lens, quiet negative space. Composition: subject small but centered, rows of empty seats barely visible around them, stage curtains in deep shadow. Lighting: single warm spotlight from above, dust visible in the beam, dark edges. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "dolly-zoom": "Create an image of: a woman frozen in realization at the end of a long hotel corridor, framed as the start frame for a dolly zoom. Style: psychological thriller still, 16:9, symmetrical composition. Composition: subject centered, corridor lines stretching away behind her, patterned carpet and repeating door frames creating strong depth cues. Lighting: sickly warm hallway sconces with cool daylight leaking from one distant window. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "extreme-macro-zoom": "Create an image of: an extreme close-up of a human eye with rain droplets on skin, framed as the start frame for an extreme macro zoom. Style: cinematic macro still, 16:9, razor-thin depth of field. Composition: iris placed slightly off-center, eyelashes and skin texture sharply detailed, background falling into black. Lighting: soft rectangular catchlight in the eye, faint coral reflection along wet skin. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "orbit-180": "Create an image of: a futuristic rider standing beside a matte black motorcycle in a wet alley, framed as the start frame for a 180 orbit. Style: cinematic character reveal still, 16:9, 35mm lens. Composition: three-quarter front view, full body visible, bike silhouette readable, enough space on both sides for camera travel. Lighting: teal streetlight from camera left, warm shop spill from camera right, wet asphalt reflections. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "orbit-360": "Create an image of: a hero character standing on a circular rooftop helipad at night, framed as the start frame for a fast 360 orbit. Style: cinematic action still, 16:9, centered subject, strong radial staging. Composition: subject locked in the middle of the frame, city lights around them, coat hanging still before movement. Lighting: helicopter searchlight from above, red warning lights around the pad, cool skyline haze. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "slow-cinematic-arc": "Create an image of: a fashion model in a sculptural black coat standing beside a tall window, framed as the start frame for a slow cinematic arc. Style: editorial film still, 16:9, 50mm lens, quiet profile reveal. Composition: three-quarter view with face turned slightly away, window grid behind the subject, clean negative space for a gentle camera curve. Lighting: soft overcast daylight from the window, warm bounce from the floor. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "dutch-orbit": "Create an image of: a bruised boxer standing alone under a flickering locker room light, framed as the start frame for a Dutch orbit. Style: gritty cinema still, 16:9, tilted composition, controlled unease. Composition: subject centered but the room lines are slightly diagonal, lockers and tiled floor creating pressure around the body. Lighting: harsh green-white overhead light, red emergency glow from a side doorway. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "crane-up": "Create an image of: a small explorer standing at the edge of a desert canyon at sunrise, framed as the start frame for a crane up. Style: cinematic establishing still, 16:9, wide lens. Composition: subject near the lower third, canyon walls and distant horizon ready to be revealed above, strong scale contrast. Lighting: low golden sun from the horizon, cool blue shadows in the canyon, fine dust in the air. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "crane-down": "Create an image of: a spacecraft hangar seen from high above with a pilot centered below, framed as the start frame for a crane down. Style: cinematic sci-fi still, 16:9, high angle. Composition: pilot small in the middle of a massive circular hangar floor, aircraft wings and service platforms forming geometric lines around them. Lighting: cold overhead industrial light, amber warning strips along the floor, light haze. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "pedestal-up": "Create an image of: a young commander rising from a chair in a dim war room, framed as the start frame for a pedestal up. Style: cinematic drama still, 16:9, waist-level camera height. Composition: camera begins low at table height, subject torso and hands visible, maps and glass reflections in the foreground. Lighting: green table lamp from below, narrow warm rim light on shoulders, dark background. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "pedestal-down": "Create an image of: a defeated athlete sitting on a wet track after rain, framed as the start frame for a pedestal down. Style: cinematic sports drama still, 16:9, eye-level start. Composition: subject centered, stadium lights high behind them, hands resting near knees, water beads on the track. Lighting: cold stadium backlight, soft front fill from reflected track, mist in the air. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "tilt-up": "Create an image of: a towering armored character standing in a smoke-filled industrial gate, framed as the start frame for a tilt up. Style: cinematic reveal still, 16:9, low camera height. Composition: boots and lower armor dominate the foreground, torso and face partially above frame, vertical pipes and doorway lines pulling upward. Lighting: hot orange furnace light from behind, cool rim light on metal edges. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "lateral-track": "Create an image of: a long museum corridor with glass cases and a single red artifact, framed as the start frame for a lateral tracking shot. Style: cinematic heist still, 16:9, precise side composition. Composition: camera placed parallel to the display line, repeated cases stretching left to right, artifact visible through glass. Lighting: soft museum spotlights, dark ceiling, polished floor reflections. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "side-tracking": "Create an image of: a woman walking beside a moving night tram, framed as the start frame for side tracking. Style: cinematic street still, 16:9, profile composition. Composition: subject in clean side profile at mid-frame, tram windows forming horizontal streaks behind her, sidewalk line parallel to camera. Lighting: warm tram interior light on face, cool rain-blue street light on coat, wet pavement. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "leading-shot": "Create an image of: a character walking straight toward camera through a crowded market at dusk, framed as the start frame for a leading shot. Style: cinematic travel drama still, 16:9, backward tracking setup. Composition: subject centered, face readable, crowd and lanterns opening behind them, enough forward space for the camera to retreat. Lighting: warm stall lights, cool evening sky, soft skin highlights. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "following-shot": "Create an image of: a lone scout walking away into a neon-lit service tunnel, framed as the start frame for a following shot. Style: cinematic sci-fi still, 16:9, over-back composition. Composition: camera behind the subject at shoulder height, corridor lines pulling forward, backpack and silhouette readable. Lighting: alternating teal and amber practical lights along the tunnel, glossy floor reflections. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "optical-zoom-in": "Create an image of: a politician alone at a press podium after midnight, framed as the start frame for a smooth optical zoom in. Style: cinematic political thriller still, 16:9, static tripod composition. Composition: podium centered, subject small enough for lens zoom to tighten, flags and empty microphones in the background. Lighting: hard white press light from front, dim room behind, slight lens softness at edges. Avoid: text, readable logos, subtitles, arrows, diagrams, motion trails, watermark.",
  "optical-zoom-out": "Create an image of: a child standing in the middle of an empty indoor swimming pool, framed as the start frame for a smooth optical zoom out. Style: cinematic mystery still, 16:9, static camera. Composition: subject starts centered and close enough to read expression, tiled pool geometry and ladders visible at the edges for the reveal. Lighting: pale skylight from above, green-blue reflected light from tiles. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "snap-zoom": "Create an image of: a suspicious briefcase on a restaurant table while diners blur in the background, framed as the start frame for a snap zoom. Style: cinematic crime still, 16:9, tense object focus. Composition: briefcase placed slightly off-center with hard edges, background characters soft but readable, strong target for the rapid zoom. Lighting: warm table lamp, cool streetlight through rain-streaked window. Avoid: text, readable labels, subtitles, arrows, diagrams, motion trails, watermark.",
  "reveal-from-blur": "Create an image of: a hospital ceiling light seen from a patient bed, framed as the start frame for a reveal from blur. Style: cinematic recovery still, 16:9, point-of-view angle. Composition: overhead light centered, doctor silhouette near the edge, shallow focus with intentional soft blur across the frame. Lighting: sterile white ceiling light, faint warm skin-tone reflection at the bottom edge. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "rack-focus": "Create an image of: a hand holding an old key in the foreground with a locked door in the background, framed as the start frame for rack focus. Style: cinematic mystery still, 16:9, shallow depth of field. Composition: key sharp in foreground left, door softly visible in background right, clear separation between both focus targets. Lighting: narrow warm hallway light, cool shadow around the door frame. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "drone-flyover": "Create an image of: a mountain road cutting through a pine forest after rain, framed as the start frame for a drone flyover. Style: cinematic aerial still, 16:9, high altitude. Composition: road begins at bottom edge and leads toward distant mountains, small car visible as scale reference, fog between trees. Lighting: early morning side light, wet asphalt reflections, low clouds. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "over-the-shoulder": "Create an image of: two rivals facing each other across a dim kitchen table, framed as the start frame for an over-the-shoulder shot. Style: cinematic conversation still, 16:9, intimate blocking. Composition: near character shoulder and back of head in foreground, far character face sharp across the table, hands visible near cups. Lighting: single warm hanging lamp above the table, cool window shadow behind. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "handheld-dynamic": "Create an image of: a firefighter pushing through a smoke-filled apartment hallway, framed as the start frame for handheld dynamic camera. Style: raw documentary cinema still, 16:9, close human perspective. Composition: subject slightly off-center, shoulder and helmet close to camera, hallway receding behind, smoke texture filling the frame. Lighting: orange fire spill from a side room, cool flashlight beam cutting through smoke. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "whip-pan": "Create an image of: a narrow city alley with a motorbike entering from frame left, framed as the start frame for a whip pan. Style: cinematic action still, 16:9, high-energy setup. Composition: foreground wall close to camera, alley stretching sideways, motorbike headlight at the edge ready to pull attention across the frame. Lighting: hard white headlight, red neon reflection on wet brick, blue night ambient. Avoid: text, readable signs, subtitles, arrows, diagrams, motion trails, watermark.",
  "barrel-roll": "Create an image of: the interior view from a small stunt plane cockpit above a desert, framed as the start frame for a barrel roll. Style: cinematic aviation still, 16:9, cockpit perspective. Composition: horizon line slightly tilted, pilot hands and instrument panel visible, desert floor and sky split diagonally through the windshield. Lighting: harsh afternoon sun, sharp shadows inside cockpit, warm dust haze outside. Avoid: text, readable gauges, subtitles, arrows, diagrams, motion trails, watermark.",
  pov: "Create an image of: first-person hands opening a heavy steel door into a flooded underground chamber, framed as the start frame for a POV shot. Style: cinematic immersive still, 16:9, human eye height. Composition: both hands visible at the bottom edge, door crack opening into darkness, rippling water reflecting light beyond. Lighting: cold flashlight beam from the viewer's hands, faint amber light deep inside the chamber. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
  "bullet-time": "Create an image of: a dancer suspended mid-jump in a room filled with floating glass shards and water droplets, framed as the start frame for bullet time. Style: stylized cinematic action still, 16:9, crisp frozen moment. Composition: subject centered in midair, shards and droplets arranged around the body with clear depth, dark studio background. Lighting: hard side light from camera left, thin rim light on glass edges, soft floor reflection. Avoid: text, subtitles, arrows, diagrams, motion trails, watermark.",
};

export const getCameraMoveThumbnailPrompt = (move: Pick<CameraMove, "slug">) =>
  cameraMoveThumbnailPrompts[move.slug] ?? "";

export const cameraEmotionLabels: Record<CameraMoveEmotion, string> = {
  action: "Action",
  attention: "Attention",
  clarity: "Clarity",
  companionship: "Companionship",
  conversation: "Conversation",
  defeat: "Defeat",
  immersion: "Immersion",
  intimacy: "Intimacy",
  isolation: "Isolation",
  power: "Power",
  scale: "Scale",
  showcase: "Showcase",
  shock: "Shock",
  tension: "Tension",
  transition: "Transition",
};

export const cameraToolSource = {
  title: "ALL Camera Movement Prompts in AI Filmmaking (30 Cinematic Moves)",
  channel: "Yannis Ashay",
  url: "https://www.youtube.com/watch?v=4-ctOYBfmDs",
  uploadDate: "2026-04-22",
};
