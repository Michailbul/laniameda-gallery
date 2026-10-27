// A world's files. The set is small on purpose: WORLD.md is the world's
// CLAUDE.md, LEARNINGS.md collects what iterations taught, and a few
// docs/<name>.md hold depth that would crowd WORLD.md. The server enforces
// these caps, so a world cannot grow into an unreadable pile: at a cap the
// agent has to promote or prune before it adds.

export const WORLD_DOC_MAIN = "WORLD.md";
export const WORLD_DOC_LEARNINGS = "LEARNINGS.md";

export const WORLD_DOC_LIMITS = {
  main: 8_000,
  learnings: 6_000,
  learningEntries: 40,
  doc: 12_000,
  docs: 8,
  note: 300,
} as const;

const DOC_PATH = /^docs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export type WorldDocPath = string;

/** Accepts WORLD.md, LEARNINGS.md (any case) and docs/<kebab-name>.md. */
export const normalizeWorldDocPath = (value: string): WorldDocPath | null => {
  const path = value.trim().replace(/^\/+/, "");
  if (path.toLowerCase() === WORLD_DOC_MAIN.toLowerCase()) return WORLD_DOC_MAIN;
  if (path.toLowerCase() === WORLD_DOC_LEARNINGS.toLowerCase()) return WORLD_DOC_LEARNINGS;
  const lower = path.toLowerCase();
  const withExt = lower.endsWith(".md") ? lower : `${lower}.md`;
  const withDir = withExt.startsWith("docs/") ? withExt : `docs/${withExt}`;
  return DOC_PATH.test(withDir) ? withDir : null;
};

/** A learning is one list line: "- L-014 · 2026-10-23 · text · src: …". */
export const countLearningEntries = (body: string) =>
  body.split("\n").filter((line) => /^\s*[-*]\s+\S/.test(line)).length;

/** The reason a body cannot be stored at this path, or null when it fits. */
export const worldDocCapError = (path: WorldDocPath, body: string, otherDocCount: number) => {
  if (path === WORLD_DOC_MAIN && body.length > WORLD_DOC_LIMITS.main) {
    return `WORLD.md is capped at ${WORLD_DOC_LIMITS.main} characters (this is ${body.length}). Move depth into a docs/<name>.md and keep WORLD.md to identity, canon pointers and rules.`;
  }
  if (path === WORLD_DOC_LEARNINGS) {
    const entries = countLearningEntries(body);
    if (body.length > WORLD_DOC_LIMITS.learnings || entries > WORLD_DOC_LIMITS.learningEntries) {
      return `LEARNINGS.md is capped at ${WORLD_DOC_LIMITS.learningEntries} entries and ${WORLD_DOC_LIMITS.learnings} characters (this is ${entries} entries, ${body.length} characters). Promote confirmed learnings into WORLD.md rules and delete superseded ones first.`;
    }
  }
  if (path.startsWith("docs/")) {
    if (body.length > WORLD_DOC_LIMITS.doc) {
      return `${path} is capped at ${WORLD_DOC_LIMITS.doc} characters (this is ${body.length}). Split it or tighten it.`;
    }
    if (otherDocCount >= WORLD_DOC_LIMITS.docs) {
      return `A world holds at most ${WORLD_DOC_LIMITS.docs} docs/ files. Merge or delete one before adding ${path}.`;
    }
  }
  return null;
};

export const WORLD_DOC_TEMPLATE = `# <WORLD NAME>

<One paragraph: what this world is, its tone, and what it is not.>

## Canon
- World bible: story:<id>
- Styles: <style-tag> (branch "<name>", lock story:<id>)

## Rules
1. <Rule> (Michael, <date>)

## Open questions
- <Question>
`;
