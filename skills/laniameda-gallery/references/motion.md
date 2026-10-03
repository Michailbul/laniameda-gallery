# Motion design references

Motion design has its own tab (Motion) and its own filters, apart from piece type
and medium. A motion reference is an ordinary asset (usually a video) plus tags.

## What makes it a motion reference

Tag it `motion-design` (category `content_type`). That is the only membership
rule: the Motion tab lists every asset carrying it. Also set the usual handles:
`inspiration` piece type when it is someone else's work, platform tag, `youtube`
or `x`, `sourceUrl`, `agentDescription`, `assetRole: "inspiration_capture"`.
Add `animation` only when the piece is drawn or 3D-animated; code-driven UI
motion is not animation in the gallery's medium sense.

## The four motion facets

Tag categories (`typedTags[].category`) the Motion tab filters on. AND across
facets, OR inside one. Reuse an existing tag before inventing one.

| Category | Question it answers | Seen so far |
|---|---|---|
| `motion_technique` | What moves, and how | morph, mask-reveal, iris, goo, parallax, kinetic-type, text-roll, glass, camera-move, path-draw, counter, stagger, shader |
| `motion_format` | What the piece is | product-launch, ui-demo, explainer, logo-reveal, title-sequence, social-ad, data-viz, loop, transition-pack |
| `motion_tool` | Where it was made | code, remotion, after-effects, canvas, three-js, gsap, css, lottie, rive, blender |
| `motion_feel` | How it plays | smooth, snappy, playful, cinematic, minimal, bold |

Only tag what is visibly true or stated by the source. `motion_tool` comes from
the source (a thread that says "every frame is code"), never from a guess.

## Templates and prompts

If the post ships a reusable prompt or template, put the text in `promptText`
(the tab shows it with a Copy button). If it is a multi-step recipe, save it as
a skill too, tagged `motion-design`, so it also turns up in the Skills tab.

## Finding them

`list_assets` / `search_gallery` with `tagNames: ["motion-design"]`, plus any
facet tag, e.g. `["motion-design","morph","remotion"]`.
