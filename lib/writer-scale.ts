// Detail at the scale of the shot: one rule every writer mode follows (Grow,
// quick edit, Make it ours), whatever world it writes for.
//
// Michael, 11 Nov 2026: a Make it ours on a frame with a woman before a far
// city added "crystal column lamps glowing along the medieval streets". At
// that distance no street can be seen, and a detail the camera cannot resolve
// breaks the wide. World markers have to be the size the shot can show: on a
// far city, a colossal statue fused into the cathedral or an airship moored at
// a spire, never a street lamp.

export const SHOT_SCALE_RULES = `Detail at the scale of the shot:
- First read how far the camera is from each part of the frame (the person in front, the street behind her, the city on the horizon) and keep those distances. Never move the camera closer to make room for detail.
- Every world detail you add has to be big enough to read at the distance it sits:
  FAR (a city on the horizon, a skyline behind a person, an aerial view): only skyline-size things. Silhouettes of towers and cathedrals, colossal statues fused into a cathedral, a low town spread as a carpet of roofs at the foot of an enormous building, a monolith, airships, smoke, light on the clouds.
  MIDDLE (a street, square, bridge or facade seen whole): building-size things. Facades, arcades, vehicles, cable cabins, figures in a crowd, lamps only as rows of points of light.
  NEAR (a person, a room, a doorway, an object): hand-size things. Lamps, signs, jewellery, garment details, small machines, flowers.
- Never add anything smaller than its distance can show: no lamps, windows, signs, street furniture or clothing details on a far city. They turn a wide into clutter and artifacts.
- Anything in the sky belongs somewhere: an airship is moored at a spire mast, follows a route or a cable line, or crosses toward the city. Never one parked in the sky at random.
- A world's list of markers covers every size. Pick the ones that fit this distance and leave the rest out.`;
