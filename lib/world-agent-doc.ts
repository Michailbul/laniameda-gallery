import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { WORLD_DOC_LEARNINGS, WORLD_DOC_MAIN } from "@/lib/world-docs";

// The AGENT view of a world: what `open_world` hands an agent, written out as
// one markdown document. WORLD.md and LEARNINGS.md are in open_world itself;
// the docs/*.md files are listed there and read with world_doc, so their text
// is appended under a note that says so. Copy-all copies exactly this text.

export type WorldContext = FunctionReturnType<typeof api.worlds.getWorldContext>;
export type WorldDocBody = { path: string; body: string; revision: number; updatedAt: number; updatedBy: string };

export type AgentDocSection = {
  /** Stable key for React and for the edit affordance. */
  id: string;
  /** Set on file sections: WORLD.md, LEARNINGS.md, docs/<name>.md. */
  docPath?: string;
  text: string;
};

const n = (value: number) => value.toLocaleString("en-GB");

const pad = (value: number) => String(value).padStart(2, "0");
/** 2026-10-28 14:03, local time: short, sortable and unambiguous. */
export const stamp = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const lines = (...parts: Array<string | false | null | undefined>) => parts.filter((part) => typeof part === "string").join("\n");

/** One section per file and per open_world block, in the order an agent reads them. */
export function buildWorldAgentSections(context: WorldContext, docs: WorldDocBody[]): AgentDocSection[] {
  const { world, limits } = context;
  const sections: AgentDocSection[] = [];
  const bodyOf = new Map(docs.map((doc) => [doc.path, doc]));

  sections.push({
    id: "head",
    text: lines(
      `# ${world.name}`,
      "",
      `> open_world · world: \`${world.key}\` · collection:${world.id} · ${n(world.rootCount)} pieces at the root`,
      world.description ? `> ${world.description.replace(/\n+/g, " ")}` : null,
    ),
  });

  const main = context.worldDoc;
  sections.push({
    id: WORLD_DOC_MAIN,
    docPath: WORLD_DOC_MAIN,
    text: lines(
      `## ${WORLD_DOC_MAIN}`,
      main
        ? `<!-- r${main.revision} · ${n(main.body.length)} / ${n(limits.worldDoc)} chars · ${stamp(main.updatedAt)} -->`
        : `<!-- not written yet · cap ${n(limits.worldDoc)} chars -->`,
      "",
      main ? main.body.trimEnd() : "_WORLD.md is not written yet._",
    ),
  });

  const learn = context.learnings;
  sections.push({
    id: WORLD_DOC_LEARNINGS,
    docPath: WORLD_DOC_LEARNINGS,
    text: lines(
      `## ${WORLD_DOC_LEARNINGS}`,
      learn
        ? `<!-- r${learn.revision} · ${learn.entries} / ${limits.learningEntries} entries · ${n(learn.body.length)} / ${n(limits.learnings)} chars -->`
        : `<!-- not written yet · cap ${limits.learningEntries} entries, ${n(limits.learnings)} chars -->`,
      "",
      learn ? learn.body.trimEnd() : "_LEARNINGS.md is not written yet._",
    ),
  });

  for (const ref of context.docs.filter((doc) => doc.path.startsWith("docs/"))) {
    const full = bodyOf.get(ref.path);
    sections.push({
      id: ref.path,
      docPath: ref.path,
      text: lines(
        `## ${ref.path}`,
        `<!-- r${ref.revision} · ${n(ref.chars)} / ${n(limits.doc)} chars · ${ref.updatedBy} · ${stamp(ref.updatedAt)} · open_world lists this file; world_doc read returns its text -->`,
        "",
        full ? full.body.trimEnd() : "_Text not loaded._",
      ),
    });
  }

  if (context.styles.length > 0 || context.otherLocks.length > 0) {
    sections.push({
      id: "styles",
      text: lines(
        `## Styles and locks (${context.styles.length})`,
        "",
        ...context.styles.map((style) => lines(
          `- \`${style.styleTag}\`${style.branch ? ` · branch: ${style.branch}` : ""} · ${style.moodboards} moodboard${style.moodboards === 1 ? "" : "s"}`,
          ...style.locks.map((lock) => `  - lock: [${lock.title}](story:${lock.id}) · ${lock.status} · r${lock.revision}`),
        )),
        ...(context.otherLocks.length > 0
          ? ["", "Other locks (no moodboard carries their style):", ...context.otherLocks.map((lock) =>
            `- [${lock.title}](story:${lock.id}) · ${lock.status}${lock.styleTag ? ` · \`${lock.styleTag}\`` : ""}`)]
          : []),
      ),
    });
  }

  sections.push({
    id: "moodboards",
    text: lines(
      `## Moodboards (${context.moodboards.length})`,
      "",
      ...(context.moodboards.length === 0 ? ["_None yet._"] : context.moodboards.map((board) => lines(
        `- **${board.name}** · ${board.collection} · ${board.status} · ${board.itemCount} items${board.styleTag ? ` · \`${board.styleTag}\`` : ""}`,
        `  - ${board.profileFlag ? `\`${board.profileFlag}\`` : "no Midjourney code"} · ${board.sync} · moodboard:${board.id}`,
      ))),
    ),
  });

  sections.push({
    id: "profiles",
    text: lines(
      `## Midjourney profiles (${context.profiles.length})`,
      "",
      ...(context.profiles.length === 0 ? ["_None linked to this world._"] : context.profiles.map((profile) =>
        `- **${profile.name}** · \`${profile.flag}\` · role: ${profile.role}${profile.styleTag ? ` · \`${profile.styleTag}\`` : ""}`)),
    ),
  });

  const shelves = [...context.shelves].sort((a, b) =>
    (a.group ?? "~").localeCompare(b.group ?? "~") || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  sections.push({
    id: "shelves",
    text: lines(
      `## Shelves (${shelves.length})`,
      "",
      ...(shelves.length === 0 ? ["_None._"] : shelves.map((shelf) =>
        `- **${shelf.name}**${shelf.group ? ` · ${shelf.group}` : ""} · ${shelf.count} pieces · collection:${shelf.id}`)),
    ),
  });

  sections.push({
    id: "storybooks",
    text: lines(
      `## Storybooks (${context.storybooks.length})`,
      "",
      ...(context.storybooks.length === 0 ? ["_None._"] : context.storybooks.map((book) => lines(
        `- **${book.name}** · ${book.count} frames · collection:${book.id}`,
        book.description ? `  > ${book.description.replace(/\n+/g, " ")}` : null,
        ...book.stories.map((story) => `  - [${story.title}](story:${story.id}) · ${story.kind} · ${story.status} · r${story.revision}`),
      ))),
    ),
  });

  if (context.storyCount > 0) {
    sections.push({
      id: "stories",
      text: lines(
        `## Stories (${context.stories.length} newest of ${context.storyCount})`,
        "",
        ...context.stories.map((story) =>
          `- [${story.title}](story:${story.id}) · ${story.kind} · ${story.status} · ${story.collection} · ${stamp(story.updatedAt)}`),
      ),
    });
  }

  sections.push({
    id: "characters",
    text: lines(
      `## Characters (${context.characters.length})`,
      "",
      ...(context.characters.length === 0 ? ["_None registered._"] : context.characters.map((character) =>
        `- \`${character.code}\` ${character.name} · ${character.status}`)),
    ),
  });

  sections.push({
    id: "changes",
    text: lines(
      `## Recent changes (${context.recentChanges.length})`,
      "",
      ...(context.recentChanges.length === 0 ? ["_Nothing journaled yet._"] : context.recentChanges.map((change) =>
        `- ${stamp(change.at)} · ${change.actor} · \`${change.op}\` · ${change.summary}${change.revertedBy ? " (undone)" : ""}`)),
    ),
  });

  sections.push({
    id: "limits",
    text: lines(
      "## Limits",
      "",
      `- ${WORLD_DOC_MAIN}: ${n(limits.worldDoc)} chars`,
      `- ${WORLD_DOC_LEARNINGS}: ${limits.learningEntries} entries, ${n(limits.learnings)} chars`,
      `- docs/<kebab-name>.md: ${limits.docs} files, ${n(limits.doc)} chars each`,
    ),
  });

  return sections;
}

export const joinAgentSections = (sections: AgentDocSection[]) =>
  sections.map((section) => section.text).join("\n\n---\n\n") + "\n";
