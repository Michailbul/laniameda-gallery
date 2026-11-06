// Editing a world page's hero inserts (folders.worldPage.heroInserts). Pure,
// so the Convex mutation and the tests share one definition.
//
// An insert is 1–3 frames: one plays full bleed, two split the screen, three
// make a triptych. The first insert opens the page; the rest cut into the
// wall in order.

export type HeroInsert<Id extends string = string> = { assetIds: Id[] };

export type HeroInsertAction = "toggle" | "add" | "remove" | "pair";

export const HERO_INSERT_MAX_FRAMES = 3;
export const HERO_INSERT_MAX = 40;

export type HeroInsertEdit<Id extends string> = {
  inserts: HeroInsert<Id>[];
  /** Whether the asset is a hero frame after the edit. */
  hero: boolean;
  /** The insert that holds it after the edit (0 = the opening hero), or null. */
  index: number | null;
  /** Frames in that insert: 1 full, 2 split, 3 triptych. */
  frames: number;
  changed: boolean;
};

const without = <Id extends string>(inserts: HeroInsert<Id>[], assetId: Id) =>
  inserts
    .map((insert) => ({ assetIds: insert.assetIds.filter((id) => id !== assetId) }))
    .filter((insert) => insert.assetIds.length > 0);

const indexOf = <Id extends string>(inserts: HeroInsert<Id>[], assetId: Id) =>
  inserts.findIndex((insert) => insert.assetIds.includes(assetId));

const same = <Id extends string>(a: HeroInsert<Id>[], b: HeroInsert<Id>[]) =>
  a.length === b.length &&
  a.every(
    (insert, i) =>
      insert.assetIds.length === b[i].assetIds.length &&
      insert.assetIds.every((id, j) => id === b[i].assetIds[j]),
  );

/**
 * Apply one owner action to the list.
 * - add: a new full-bleed insert at the end (no-op when already a hero frame).
 * - remove: take it out; an insert left empty goes too.
 * - toggle: remove when it is a hero frame, add otherwise.
 * - pair: join the previous (last) insert to make a split or a triptych; a
 *   full previous insert (three frames) or none starts a new one. Pairing a
 *   frame that already sits in the last insert with others is a no-op.
 */
export const editHeroInserts = <Id extends string>(
  current: HeroInsert<Id>[],
  assetId: Id,
  action: HeroInsertAction,
): HeroInsertEdit<Id> => {
  const at = indexOf(current, assetId);
  let next: HeroInsert<Id>[];
  if (action === "remove" || (action === "toggle" && at >= 0)) {
    next = without(current, assetId);
  } else if (action === "add" || action === "toggle") {
    next = at >= 0 ? current : [...current, { assetIds: [assetId] }];
  } else {
    const last = current[current.length - 1];
    if (at >= 0 && at === current.length - 1 && last.assetIds.length > 1) {
      next = current;
    } else {
      next = without(current, assetId);
      const previous = next[next.length - 1];
      if (previous && previous.assetIds.length < HERO_INSERT_MAX_FRAMES) {
        next = [...next.slice(0, -1), { assetIds: [...previous.assetIds, assetId] }];
      } else {
        next = [...next, { assetIds: [assetId] }];
      }
    }
  }
  next = next.slice(0, HERO_INSERT_MAX);
  const index = indexOf(next, assetId);
  return {
    inserts: next,
    hero: index >= 0,
    index: index >= 0 ? index : null,
    frames: index >= 0 ? next[index].assetIds.length : 0,
    changed: !same(current, next),
  };
};

/** Clean a list an agent or the settings call sends: 1–3 unique frames per insert, no frame twice. */
export const normalizeHeroInserts = <Id extends string>(inserts: HeroInsert<Id>[]) => {
  const seen = new Set<string>();
  const out: HeroInsert<Id>[] = [];
  for (const insert of inserts) {
    const ids = insert.assetIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (ids.length) out.push({ assetIds: ids.slice(0, HERO_INSERT_MAX_FRAMES) });
    if (out.length >= HERO_INSERT_MAX) break;
  }
  return out;
};

/** What H did, in plain words: "Hero · opens DEAR ANNETE", "Hero · split, cut 3 of DEAR ANNETE". */
export const heroNotice = (result: {
  world: string;
  hero: boolean;
  index: number | null;
  frames: number;
}) => {
  if (!result.hero || result.index === null) return `No longer a hero on ${result.world}`;
  const shape = result.frames === 3 ? "triptych" : result.frames === 2 ? "split" : "full screen";
  return result.index === 0
    ? `Hero · opens the ${result.world} page · ${shape}`
    : `Hero · cut ${result.index} on the ${result.world} page · ${shape}`;
};
