// Every Midjourney job the gallery queues, copies or writes is --v 8.2.
// Michael, 11 Nov 2026: never V7 (or older). Michael, 15 Nov 2026: "never use
// mj v8.1, do not let it happen". So a pinned version below 8.2 (--v 8.1,
// --version 8.1, --v 7, --v 6.1 …) is rewritten to --v 8.2 wherever a command
// is composed, and the item says so. Niji (--niji) is left as written here;
// the queue composer (lib/mj-queue.ts) turns it into --v 8.2 (17 Nov 2026). The extension carries a line-for-line twin of
// enforceMjVersion inside extension/mj-queue-compose.js; the parity test
// (tests/mj-queue-compose.test.ts) keeps the two identical.

export const MJ_VERSION = "8.2";

// "--v 8.1", "--version 7", "--v8.1", and the en/em dash a Mac's smart
// punctuation makes of "--" ("—v 8.1").
const VERSION_FLAG = /(^|\s)(?:--|[–—])(?:v|version)(?:\s+|(?=\d))(\d+(?:\.\d+)?)(?=\s|$)/gi;

export const isRetiredMjVersion = (value: string) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number < Number.parseFloat(MJ_VERSION);
};

export const mjVersionWarning = (from: string) => `v${from} is not used: switched to v${MJ_VERSION}`;

/**
 * The text with every retired --v/--version rewritten to --v 8.2 (and a
 * second version flag dropped), plus the versions it replaced, in order.
 * Text without a version flag comes back unchanged: the default is V8.2.
 */
export function enforceMjVersion(text: string | undefined | null): { text: string; replaced: string[] } {
  const input = String(text ?? "");
  const replaced: string[] = [];
  let seen = false;
  const output = input.replace(VERSION_FLAG, (whole: string, lead: string, value: string) => {
    const retired = isRetiredMjVersion(value);
    if (retired && !replaced.includes(value)) replaced.push(value);
    if (seen) return "";
    seen = true;
    return retired ? `${lead}--v ${MJ_VERSION}` : whole;
  });
  return { text: output, replaced };
}

/** Params ready to store: the version enforced and the first version it replaced, for the item's warning. */
export function versionedParams(params: string | undefined) {
  if (params === undefined) return { params: undefined, replacedVersion: undefined };
  const { text, replaced } = enforceMjVersion(params);
  return { params: text.trim() || undefined, replacedVersion: replaced[0] };
}
