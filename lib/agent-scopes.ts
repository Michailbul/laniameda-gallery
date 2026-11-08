// Agent token permissions. gallery:* are owner-wide. The two inspiration
// scopes are narrow on purpose (critic P0.3, skill:qh797xrkgc61h6ddpf52fnbhzh8hks0b):
//
// - inspiration:capture — a capture worker (main's Telegram intake) can
//   register a reference, upload and attach private originals, and read that
//   source back to confirm it was saved. It cannot list the library, read the
//   rest of the gallery, propose takes, dispatch paid work or delete.
// - inspiration:adapt — a project specialist can read the inspiration
//   library and Michael's notes, and propose, post versions, block and
//   dispatch only for adaptations whose project is one of the token's
//   worlds. Nothing else in the gallery.
//
// Owner decisions (keep, drop, approve, promote, redo, allowance, delete a
// private original, clear a processor) are never in any token.

export const AGENT_TOKEN_SCOPES = [
  "gallery:read", "gallery:write", "gallery:delete", "inspiration:capture", "inspiration:adapt",
] as const;
export type AgentTokenScope = (typeof AGENT_TOKEN_SCOPES)[number];

export const isAgentTokenScope = (value: unknown): value is AgentTokenScope =>
  typeof value === "string" && (AGENT_TOKEN_SCOPES as readonly string[]).includes(value);

export const SCOPE_LABEL: Record<AgentTokenScope, string> = {
  "gallery:read": "Read",
  "gallery:write": "Write",
  "gallery:delete": "Delete",
  "inspiration:capture": "Capture inspiration only",
  "inspiration:adapt": "Takes for chosen projects only",
};

export const SCOPE_HINT: Record<AgentTokenScope, string> = {
  "gallery:read": "See everything in the gallery.",
  "gallery:write": "Save and edit pieces, prompts, tags and collections.",
  "gallery:delete": "Remove pieces, prompts and collections.",
  "inspiration:capture": "Save references and private photos into Inspiration, and check they arrived. Nothing else.",
  "inspiration:adapt": "Read Inspiration and make takes for the projects you pick. Nothing else.",
};

export type InspirationAgentAction =
  | "list" | "get" | "feedback" | "register" | "propose" | "post_version" | "block" | "dispatch" | "job" | "private_media";

// Which scopes open each inspiration action. Any one is enough.
export const INSPIRATION_ACTION_SCOPES: Record<InspirationAgentAction, AgentTokenScope[]> = {
  list: ["gallery:read", "inspiration:adapt"],
  get: ["gallery:read", "inspiration:adapt", "inspiration:capture"],
  feedback: ["gallery:read", "inspiration:adapt"],
  register: ["gallery:write", "inspiration:capture"],
  private_media: ["gallery:write", "inspiration:capture"],
  propose: ["gallery:write", "inspiration:adapt"],
  post_version: ["gallery:write", "inspiration:adapt"],
  block: ["gallery:write", "inspiration:adapt"],
  dispatch: ["gallery:write", "inspiration:adapt"],
  job: ["gallery:write", "inspiration:adapt"],
};

export type TokenReach = { scopes: readonly string[]; worldIds?: readonly string[] };

/** The scope that let this token in, or null. Owner-wide scopes win over narrow ones. */
export const grantingScope = (token: TokenReach, allowed: readonly AgentTokenScope[]): AgentTokenScope | null =>
  allowed.find((scope) => scope.startsWith("gallery:") && token.scopes.includes(scope))
  ?? allowed.find((scope) => token.scopes.includes(scope))
  ?? null;

/**
 * For a token let in only by inspiration:adapt: is this project one of its
 * worlds? A take with no project (general/library) is outside every world.
 */
export const adaptReachesWorld = (token: TokenReach, worldId: string | undefined) =>
  Boolean(worldId && token.worldIds?.includes(worldId));
