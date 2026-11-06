// The world page wall: frames packed into columns in chunks of ~18, a
// full-screen hero insert between chunks. Pure arithmetic on known aspect
// ratios, so the whole wall is laid out before a single image loads and only
// the boxes near the screen mount.
//
// No holes: CSS columns leave a ragged bottom on every chunk, which reads as
// black gaps above each insert. Here every chunk ends level. Short columns
// first stretch their last frame (cropped by object-fit: cover, at most 35%
// taller); a gap still left over gets a filler, a slow drifting detail crop
// of a frame next to it.

export type WallTileBox = { kind: "tile"; index: number; x: number; y: number; w: number; h: number };
export type WallInsertBox = { kind: "insert"; insert: number; x: number; y: number; w: number; h: number };
export type WallFillerBox = {
  kind: "filler";
  /** The frame whose detail it shows (a neighbour, never the frame right above). */
  source: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type WallBox = WallTileBox | WallInsertBox | WallFillerBox;

export type WallLayout = { boxes: WallBox[]; height: number; colW: number; cols: number };

/** Few, large frames: a pitch, not a contact sheet. */
export const wallColumnsFor = (width: number) => (width < 900 ? 2 : width < 1800 ? 3 : 4);
/** Frames between two inserts. */
export const wallChunkFor = (cols: number) => (cols <= 2 ? 10 : 18);

/** A column's last frame may grow this much (of its own height) to level the chunk. */
export const MAX_STRETCH = 0.35;
/** A gap smaller than this is closed by stretching a little further instead of a sliver of filler. */
export const MIN_FILLER = 56;

export type WallInput = {
  /** Height over width of every frame, in wall order. */
  ratios: number[];
  /** Inserts available to cut in, in order. */
  inserts: number;
  width: number;
  gap: number;
  /** Height of an insert block (it holds a sticky full-screen frame). */
  insertHeight: number;
  /** Every frame is loaded: the last chunk may close (level) too. */
  complete: boolean;
  cols?: number;
  per?: number;
};

/** How far a chunk's end may move (either way) to find the levellest cut. */
export const CHUNK_SLACK = 2;

type Placement = { index: number; col: number; y: number; h: number };

/**
 * Pack frames [start, end) into columns starting level at `top`: shortest
 * column first, in order, except the last two rows' worth, which go
 * tallest-first to the shortest column so the chunk ends nearly level.
 */
const packChunk = (
  heights: number[],
  start: number,
  end: number,
  cols: number,
  top: number,
  gap: number,
) => {
  const bottoms = new Array<number>(cols).fill(top);
  const started = new Array<boolean>(cols).fill(false);
  const placements: Placement[] = [];
  const place = (index: number) => {
    let col = 0;
    for (let c = 1; c < cols; c++) if (bottoms[c] < bottoms[col] - 1) col = c;
    const y = started[col] ? bottoms[col] + gap : bottoms[col];
    placements.push({ index, col, y, h: heights[index] });
    bottoms[col] = y + heights[index];
    started[col] = true;
  };
  const tail = Math.min(cols * 2, end - start);
  for (let index = start; index < end - tail; index++) place(index);
  const rest = Array.from({ length: tail }, (_, i) => end - tail + i).sort(
    (a, b) => heights[b] - heights[a] || a - b,
  );
  for (const index of rest) place(index);
  return { placements, bottoms };
};

/** Leftover gap a chunk would need filled after its frames stretch (lower is better). */
const residual = (pack: ReturnType<typeof packChunk>, cols: number) => {
  const target = Math.max(...pack.bottoms);
  const lastH = new Array<number>(cols).fill(0);
  for (const p of pack.placements) lastH[p.col] = p.h;
  let left = 0;
  for (let c = 0; c < cols; c++) {
    left += Math.max(0, target - pack.bottoms[c] - lastH[c] * MAX_STRETCH);
  }
  return left;
};

export function layoutWall(input: WallInput): WallLayout {
  const { ratios, width, gap, insertHeight, complete } = input;
  const cols = input.cols ?? wallColumnsFor(width);
  const per = input.per ?? wallChunkFor(cols);
  if (!width || !ratios.length) return { boxes: [], height: 0, colW: 0, cols };
  const colW = (width - gap * (cols - 1)) / cols;
  const xOf = (col: number) => Math.round(col * (colW + gap));
  const w = Math.round(colW);
  const heights = ratios.map((ratio) => Math.round(colW * Math.min(2.4, Math.max(0.3, ratio || 1))));
  const count = ratios.length;
  const boxes: WallBox[] = [];
  let top = 0;
  let insertsLeft = input.inserts;
  let insertNo = 0;

  for (let start = 0; start < count; ) {
    // A chunk closes (levels, then takes an insert) once the frames after it
    // are loaded, so its cut never moves under the reader; the last chunk
    // closes when everything is in. A tiny last chunk joins this one.
    const lastWindow = start + per + CHUNK_SLACK + cols * 2 > count;
    const closesHere = !lastWindow;
    let end: number;
    if (closesHere) {
      let best = { end: start + per, score: Infinity };
      for (let e = start + per - CHUNK_SLACK; e <= start + per + CHUNK_SLACK; e++) {
        const score = residual(packChunk(heights, start, e, cols, top, gap), cols);
        if (score < best.score - 0.5) best = { end: e, score };
      }
      end = best.end;
    } else {
      end = count;
    }
    const isLast = end >= count;
    const closes = !isLast || complete;
    const { placements, bottoms } = closes
      ? packChunk(heights, start, end, cols, top, gap)
      : packInOrder(heights, start, end, cols, top, gap);

    const last = new Array<number>(cols).fill(-1);
    const started = new Array<boolean>(cols).fill(false);
    for (const p of placements) {
      last[p.col] = boxes.length;
      started[p.col] = true;
      boxes.push({ kind: "tile", index: p.index, x: xOf(p.col), y: p.y, w, h: p.h });
    }

    if (!closes) {
      top = Math.max(...bottoms);
      break;
    }

    const target = Math.max(...bottoms);
    for (let c = 0; c < cols; c++) {
      let short = target - bottoms[c];
      if (short <= 0.5) continue;
      const lastBox = last[c] >= 0 ? (boxes[last[c]] as WallTileBox) : null;
      if (lastBox) {
        const room = lastBox.h * MAX_STRETCH;
        // Close a small remainder by stretching a little further, never past
        // 60%: a sliver of filler reads worse than a tighter crop.
        const grow =
          short <= room || (short - room < MIN_FILLER && short <= lastBox.h * 0.6) ? short : room;
        lastBox.h += Math.round(grow);
        short -= grow;
        bottoms[c] += grow;
      }
      if (short <= 0.5) continue;
      const y = started[c] ? bottoms[c] + gap : bottoms[c];
      boxes.push({
        kind: "filler",
        source: fillerSource(boxes, last, c, cols),
        x: xOf(c),
        y,
        w,
        h: Math.max(1, Math.round(target - y)),
      });
    }

    top = target;
    if (!isLast) {
      if (insertsLeft > 0) {
        const y = top + gap;
        boxes.push({ kind: "insert", insert: insertNo++, x: 0, y, w: Math.round(width), h: insertHeight });
        insertsLeft -= 1;
        top = y + insertHeight;
      }
      top += gap;
    }
    start = end;
  }

  return { boxes, height: top, colW, cols };
}

/** An open chunk keeps plain reading order: frames still arriving never reshuffle it. */
const packInOrder = (heights: number[], start: number, end: number, cols: number, top: number, gap: number) => {
  const bottoms = new Array<number>(cols).fill(top);
  const started = new Array<boolean>(cols).fill(false);
  const placements: Placement[] = [];
  for (let index = start; index < end; index++) {
    let col = 0;
    for (let c = 1; c < cols; c++) if (bottoms[c] < bottoms[col] - 1) col = c;
    const y = started[col] ? bottoms[col] + gap : bottoms[col];
    placements.push({ index, col, y, h: heights[index] });
    bottoms[col] = y + heights[index];
    started[col] = true;
  }
  return { placements, bottoms };
};

/** A neighbouring column's frame beside the gap, so the filler is never the frame right above it. */
const fillerSource = (boxes: WallBox[], last: number[], col: number, cols: number) => {
  for (const c of [col + 1, col - 1, col + 2, col - 2]) {
    if (c < 0 || c >= cols || last[c] < 0) continue;
    const box = boxes[last[c]];
    if (box.kind === "tile") return box.index;
  }
  const own = last[col] >= 0 ? boxes[last[col]] : null;
  return own && own.kind === "tile" ? own.index : 0;
};
