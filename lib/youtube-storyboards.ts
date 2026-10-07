/** Public YouTube seek-preview tiles, with their actual sampled timestamps. */
export type YouTubeStoryboardFrame = {
  url: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  column: number;
  row: number;
  timeSeconds: number;
};

export const isYouTubeVideoId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id);

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

// Read just the player JSON. Balanced braces handle nested objects and strings
// containing `};`, without evaluating any script from the watch page.
export function parseYouTubePlayer(html: string): Record<string, unknown> | undefined {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/g;
  for (const match of html.matchAll(marker)) {
    const start = match.index + match[0].length;
    if (html[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < html.length; index++) {
      const character = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) {
        try {
          const player = record(JSON.parse(html.slice(start, index + 1)));
          if (player) return player;
        } catch { /* Malformed assignment: try the next player response. */ }
        break;
      }
    }
  }
}

type Level = {
  level: number;
  width: number;
  height: number;
  count: number;
  columns: number;
  rows: number;
  intervalMs: number;
  name: string;
  signature: string;
};

const imageUrl = (template: string, level: Level, sheet: number) => {
  try {
    const name = level.name.replace(/\$M/g, String(sheet));
    const url = new URL(template.replace(/\$L/g, String(level.level))
      .replace(/\$N/g, name).replace(/\$M/g, String(sheet)));
    if (url.protocol !== "https:" || url.hostname !== "i.ytimg.com" ||
        url.port || url.username || url.password || /\$[A-Z]/.test(url.href)) return;
    url.searchParams.set("sigh", level.signature);
    return url.href;
  } catch { return; }
};

/** Select up to 24 unique tiles: opening checkpoints and the rest of the video. */
export function sampleYouTubeStoryboard(spec: string, durationSeconds: number): YouTubeStoryboardFrame[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const [template, ...parts] = spec.split("|");
  const levels: Level[] = [];
  parts.forEach((part, level) => {
    const [w, h, count, columns, rows, interval, name, signature] = part.split("#");
    const numbers = [w, h, count, columns, rows, interval].map(Number);
    if (numbers.some((n) => !Number.isSafeInteger(n) || n <= 0) || !name || !signature) return;
    const [width, height, total, cols, rowCount, intervalMs] = numbers;
    if (width > 4096 || height > 4096 || cols > 100 || rowCount > 100 || total > 1_000_000) return;
    const candidate = { level, width, height, count: total, columns: cols, rows: rowCount, intervalMs, name, signature };
    if (imageUrl(template, candidate, 0)) levels.push(candidate);
  });
  const level = levels.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!level) return [];
  // Count excludes the unused/blank cells at the end of the last sprite sheet.
  const count = Math.min(level.count, Math.floor(durationSeconds * 1000 / level.intervalMs) + 1);
  const last = count - 1;
  const target = Math.min(24, count);
  const indexes = new Set<number>();
  for (const seconds of [0, 10, 20, 30]) {
    if (seconds <= durationSeconds) indexes.add(Math.min(last, Math.floor(seconds * 1000 / level.intervalMs)));
  }
  const remaining = target - indexes.size;
  for (let index = 1; index <= remaining; index++) indexes.add(Math.floor(last * index / remaining));
  // Sparse or coarse storyboards may collapse checkpoint requests to one tile.
  // Fill any gaps with unique tiles, always splitting the widest time gap.
  while (indexes.size < target) {
    const sorted = [...indexes].sort((a, b) => a - b);
    let gapStart = 0;
    let gapSize = 0;
    for (let index = 1; index < sorted.length; index++) {
      const gap = sorted[index] - sorted[index - 1];
      if (gap > gapSize) { gapStart = sorted[index - 1]; gapSize = gap; }
    }
    if (gapSize <= 1) break;
    indexes.add(gapStart + Math.floor(gapSize / 2));
  }
  const perSheet = level.columns * level.rows;
  return [...indexes].sort((a, b) => a - b).flatMap((index) => {
    const sheet = Math.floor(index / perSheet);
    const url = imageUrl(template, level, sheet);
    if (!url) return [];
    const tile = index % perSheet;
    // YouTube crops unused rows off its final image, rather than padding the
    // sheet to the maximum grid height. Use the actual sprite height for CSS.
    const rows = Math.ceil(Math.min(perSheet, level.count - sheet * perSheet) / level.columns);
    return [{ url, width: level.width, height: level.height, columns: level.columns, rows,
      column: tile % level.columns, row: Math.floor(tile / level.columns), timeSeconds: index * level.intervalMs / 1000 }];
  });
}

export function storyboardsFromWatchPage(html: string): YouTubeStoryboardFrame[] {
  const player = parseYouTubePlayer(html);
  const spec = record(record(player?.storyboards)?.playerStoryboardSpecRenderer)?.spec;
  const duration = Number(record(player?.videoDetails)?.lengthSeconds);
  return typeof spec === "string" ? sampleYouTubeStoryboard(spec, duration) : [];
}
