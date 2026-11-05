import { z } from "zod";

// package_style: turn a found Midjourney recipe into a world style lock with its
// example frames and an honest moodboard state. The pure parts live here (input
// contract, board matching, the lock's markdown) so the MCP tool only fetches
// and saves, and tests can pin the body without a gallery.

const code = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/, "A Midjourney code has no spaces or punctuation, e.g. l9gg966.");
const line = z.string().trim().min(1).max(400);

export const stylePackageSchema = z.object({
  world: z.string().trim().min(1).max(200).describe("World key (dear-annete-3d), name or root id. The lock, the examples and the style shelf all live in it."),
  name: z.string().trim().min(1).max(80).describe("The style's name, e.g. Patent Noir."),
  styleTag: z.string().trim().min(1).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase hyphenated, e.g. da-3d-patent-noir.").describe("Lowercase hyphenated style key the lock carries."),
  title: z.string().trim().min(1).max(200).optional().describe("Lock title. Default: <WORLD> · <name> · Midjourney recipe."),
  logline: z.string().trim().max(400).optional().describe("One sentence on what the look is."),
  status: z.enum(["draft", "ready"]).optional().describe("draft (default) until Michael locks it; ready only on his word."),
  shelf: z.string().trim().min(1).max(200).optional().describe("Style shelf of this world (id or exact name). The lock is filed there and so are the examples; omit for the world root."),
  recipe: z.object({
    opener: z.string().trim().min(1).max(600).describe("The opening sentence every prompt starts with."),
    moodboardCodes: z.array(code).max(6).default([]).describe("Personalization codes of the moodboards in the recipe, in prompt order (l9gg966). Each is matched to its gallery board."),
    profileCodes: z.array(code).max(6).default([]).describe("Taste profile codes after the boards (8fpptvh). Empty = no profile."),
    parameters: z.string().trim().max(400).default("").describe("Everything after --profile, e.g. --chaos 20 --ar 4:3 --stylize 650 --hd --v 8.2."),
    template: z.string().trim().max(2000).optional().describe("Copy-ready prompt with [SUBJECT]-style slots. Default: opener + [SCENE] + the flags."),
    midjourneyFolder: z.string().trim().max(120).optional().describe("Midjourney web folder jobs go into."),
  }),
  exampleAssetIds: z.array(z.string().trim().min(1)).min(1).max(12).describe("asset:<id> of the frames that show the look, already saved in this world with their full prompts."),
  raises: z.array(line).max(20).default([]).describe("Words, parameters or choices that bring the look on, each with its evidence."),
  lowers: z.array(line).max(20).default([]).describe("What loses it, each with its evidence."),
  evidence: z.string().trim().max(4000).optional().describe("Markdown: hit rate, likes, what was compared."),
  notes: z.string().trim().max(8000).optional().describe("Markdown: anything else a later agent needs (aliases, open questions)."),
  fileExamples: z.boolean().optional().describe("Add the examples to the style shelf (default true when shelf is given)."),
  ingestKey: z.string().trim().min(1).max(300).optional().describe("Default style-lock:<worldKey>:<slug of name>. Same key = same lock, updated."),
  expectedRevision: z.number().int().nonnegative().optional().describe("Needed to change an existing lock: its current revision."),
  dryRun: z.boolean().optional().describe("Compose and check everything, write nothing; returns the body."),
  session: z.string().trim().max(80).optional(),
});
export type StylePackageInput = z.output<typeof stylePackageSchema>;

export const styleSlug = (name: string) =>
  name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "style";

export const stylePackageIngestKey = (worldKey: string, name: string) => `style-lock:${worldKey}:${styleSlug(name)}`;

export type BoardRow = {
  _id: string; name: string; folderId: string; folderName?: string; status?: string; itemCount?: number;
  mjCode?: string; mjMoodboardId?: string; mjCodeHistory?: { code: string }[]; url?: string;
};

export type BoardMatch =
  | { code: string; state: "linked"; board: BoardRow }
  | { code: string; state: "other-world"; board: BoardRow; worldName?: string }
  | { code: string; state: "missing" };

/** A code matches a board by its current code, an earlier code or its Midjourney id (m<id> too). */
export const boardForCode = (boards: readonly BoardRow[], wanted: string) => {
  const bare = wanted.replace(/^m(?=\d{6,}$)/, "");
  const score = (board: BoardRow) =>
    board.mjCode === wanted ? 3
      : board.mjMoodboardId !== undefined && board.mjMoodboardId === bare ? 2
        : (board.mjCodeHistory ?? []).some((entry) => entry.code === wanted) ? 1 : 0;
  return [...boards].map((board) => ({ board, rank: score(board) })).filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank || (a.board.status === "archived" ? 1 : 0) - (b.board.status === "archived" ? 1 : 0))[0]?.board;
};

export const matchBoards = (codes: readonly string[], boards: readonly BoardRow[], worldFolderIds: ReadonlySet<string>): BoardMatch[] =>
  codes.map((wanted) => {
    const board = boardForCode(boards, wanted);
    if (!board) return { code: wanted, state: "missing" as const };
    return worldFolderIds.has(board.folderId) ? { code: wanted, state: "linked" as const, board } : { code: wanted, state: "other-world" as const, board };
  });

export const MISSING_BOARD_FLAG = "MOODBOARD NOT CREATED YET";

export type StyleExample = { id: string; prompt?: string; description?: string; sourceUrl?: string; thumbUrl?: string };

export const profileFlag = (recipe: Pick<StylePackageInput["recipe"], "moodboardCodes" | "profileCodes">) => {
  const codes = [...recipe.moodboardCodes, ...recipe.profileCodes];
  return codes.length ? `--profile ${codes.join(" ")}` : "";
};

export const defaultTemplate = (recipe: StylePackageInput["recipe"]) =>
  [recipe.opener.replace(/[\s,]+$/, ","), "[SCENE: who, where, doing what, one light source, in short plain sentences].", profileFlag(recipe), recipe.parameters]
    .filter(Boolean).join(" ");

const boardLine = (match: BoardMatch) => {
  if (match.state === "missing") {
    return `- \`${match.code}\` · **${MISSING_BOARD_FLAG}.** No gallery board carries this code. Build it in the gallery first (references/moodboards.md), get Michael's pick, then mirror it to Midjourney and record the code with set_moodboard_midjourney.`;
  }
  const { board } = match;
  const head = `- \`${match.code}\` · ${board.name} · moodboard:${board._id}${board.itemCount !== undefined ? ` · ${board.itemCount} images` : ""}${board.status ? ` · ${board.status}` : ""}`;
  return match.state === "linked"
    ? `${head}. Lives in this world (${board.folderName ?? "root"}).`
    : `${head}. Lives in another world${match.worldName ? ` (${match.worldName}` : " ("}${board.folderName ? ` › ${board.folderName}` : ""}): used here as a Midjourney code only. Boards never cross worlds, so it is cited, not linked; change it only in its own world.`;
};

const bullets = (items: readonly string[], empty: string) => (items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`);

export const buildStyleLockBody = (args: {
  input: StylePackageInput; worldName: string; worldKey: string; ingestKey: string;
  boards: readonly BoardMatch[]; examples: readonly StyleExample[]; date: string;
}) => {
  const { input, boards, examples } = args;
  const { recipe } = input;
  const missing = boards.filter((match) => match.state === "missing").map((match) => `\`${match.code}\``);
  const borrowed = boards.filter((match) => match.state === "other-world");
  const flags = [
    missing.length ? `> **${MISSING_BOARD_FLAG}:** ${missing.join(", ")}. The recipe names a Midjourney code with no gallery board.` : "",
    borrowed.length ? `> Moodboard from another world: ${borrowed.map((match) => `\`${match.code}\``).join(", ")} (see Moodboards).` : "",
    !recipe.moodboardCodes.length ? "> No moodboard in this recipe: the look comes from words and profiles only." : "",
  ].filter(Boolean);
  const template = recipe.template ?? defaultTemplate(recipe);
  const sections = [
    `# ${input.name}`,
    input.logline ?? "",
    `Status: **${input.status ?? "draft"}**${(input.status ?? "draft") === "draft" ? " (a found recipe, not locked by Michael)" : ""}. World: ${args.worldName} (\`${args.worldKey}\`). Style tag: \`${input.styleTag}\`.`,
    flags.join("\n"),
    "## Recipe",
    [
      `- Opener: "${recipe.opener}"`,
      `- Moodboards: ${recipe.moodboardCodes.length ? recipe.moodboardCodes.map((value) => `\`${value}\``).join(" ") : "none"}`,
      `- Profiles: ${recipe.profileCodes.length ? recipe.profileCodes.map((value) => `\`${value}\``).join(" ") : "none"}`,
      `- Parameters: ${recipe.parameters ? `\`${recipe.parameters}\`` : "Midjourney defaults"}`,
      recipe.midjourneyFolder ? `- Midjourney folder: ${recipe.midjourneyFolder}` : "",
    ].filter(Boolean).join("\n"),
    "## Copy-ready prompt",
    "```text\n" + template + "\n```",
    "## Moodboards",
    boards.length ? boards.map(boardLine).join("\n") : "- None in this recipe.",
    "## Examples",
    examples.map((example, index) => [
      `${index + 1}. asset:${example.id}${example.description ? ` · ${example.description}` : ""}`,
      example.prompt ? `   Prompt: \`${example.prompt.replace(/`/g, "'")}\`` : "   Prompt: not stored on the asset.",
      example.sourceUrl ? `   Source: ${example.sourceUrl}` : "",
    ].filter(Boolean).join("\n")).join("\n"),
    "## What raises the look",
    bullets(input.raises, "Not measured yet."),
    "## What lowers it",
    bullets(input.lowers, "Not measured yet."),
    input.evidence ? `## Evidence\n${input.evidence}` : "",
    input.notes ? `## Notes\n${input.notes}` : "",
    `---\nPackaged with package_style on ${args.date}. ingestKey \`${args.ingestKey}\`. Re-run package_style with the same key and expectedRevision to update it; older text stays in get_story_revisions.`,
  ];
  return sections.filter((section) => section.trim()).join("\n\n");
};
