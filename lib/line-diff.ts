// A small line diff for the world journal: longest common subsequence over
// lines, then the edit script. World docs are capped at 12,000 characters, so
// the quadratic table stays small; past MAX_CELLS it falls back to a plain
// "all removed, all added" script instead of freezing the tab.

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

const MAX_CELLS = 2_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");

  // Shared head and tail need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...head,
      ...midA.map((text) => ({ kind: "remove" as const, text })),
      ...midB.map((text) => ({ kind: "add" as const, text })),
      ...tail,
    ];
  }

  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = midA[i] === midB[j]
        ? table[(i + 1) * cols + j + 1]! + 1
        : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }

  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: "same", text: midA[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      middle.push({ kind: "remove", text: midA[i]! });
      i += 1;
    } else {
      middle.push({ kind: "add", text: midB[j]! });
      j += 1;
    }
  }
  while (i < midA.length) middle.push({ kind: "remove", text: midA[i++]! });
  while (j < midB.length) middle.push({ kind: "add", text: midB[j++]! });

  return [...head, ...middle, ...tail];
}

export type DiffHunkLine = DiffLine | { kind: "gap"; text: string; hidden: number };

/** Keeps `context` unchanged lines around each change and folds the rest. */
export function foldDiff(lines: DiffLine[], context = 2): DiffHunkLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = true;
  });
  const out: DiffHunkLine[] = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden > 0) out.push({ kind: "gap", text: "", hidden });
      hidden = 0;
      out.push(line);
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) out.push({ kind: "gap", text: "", hidden });
  return out;
}
