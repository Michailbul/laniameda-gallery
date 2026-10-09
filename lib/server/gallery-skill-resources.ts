import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canActorAccessByUserId } from "@/lib/identity";

export const GALLERY_SKILL_ORIGIN = "https://gallery.laniameda.space";
export const GALLERY_SKILL_PATH = "/skills/laniameda-gallery";

// Private world policy belongs to this gallery's owner, even if the
// MCP allowlist is later expanded to other accounts.
export const isGallerySkillOwner = (ownerUserId: string, configuredOwner: string | undefined) => {
  const owner = configuredOwner?.trim() ?? "";
  return Boolean(owner) && canActorAccessByUserId(ownerUserId, [owner]);
};

export const GALLERY_SKILL_RESOURCES = [
  { path: "SKILL.md", title: "Canonical gallery skill", access: "public" },
  { path: "references/web-access.md", title: "Fetching and using the skill", access: "public" },
  { path: "references/ingest.md", title: "Save, update, delete and filing contracts", access: "public" },
  { path: "references/ingest-examples.md", title: "Ingest examples", access: "public" },
  { path: "references/query.md", title: "Media and Skill retrieval", access: "public" },
  { path: "references/data-model.md", title: "Data model and field meanings", access: "public" },
  { path: "references/stories.md", title: "Stories, style locks and filter presets", access: "public" },
  { path: "references/storybooks.md", title: "Storybook production spec", access: "public" },
  { path: "references/bookmarks.md", title: "X post bookmarks", access: "public" },
  { path: "references/video-refs.md", title: "YouTube research", access: "public" },
  { path: "references/motion.md", title: "Motion media and facets", access: "public" },
  { path: "references/cinematography.md", title: "Cinematography Skill packs", access: "public" },
  { path: "references/extraction.md", title: "Reference capture and provenance", access: "public" },
  { path: "references/worlds.md", title: "Michael's current world rules and IDs", access: "owner" },
  { path: "references/maintenance.md", title: "Private installation and deployment notes", access: "owner" },
  { path: "scripts/gallery.mjs", title: "Standalone Bun MCP client", access: "public" },
  { path: "scripts/gallery-client.mjs", title: "Importable Gallery client for custom Bun scripts", access: "public" },
] as const;

type Dependencies = {
  authorizeOwner: (request: Request) => Promise<Response | null>;
  readSource?: (path: string) => Promise<string>;
};

const readSource = (path: string) =>
  readFile(join(process.cwd(), "skills/laniameda-gallery", path), "utf8");

const sourceVersion = (skill: string) =>
  /^version:\s*([^\r\n]+)$/m.exec(skill)?.[1]?.trim() ?? "unversioned";

const digest = (source: string) => createHash("sha256").update(source).digest("hex");

const resourceUrl = (path: string) => `${GALLERY_SKILL_ORIGIN}${GALLERY_SKILL_PATH}/${path}`;

export const buildGalleryLlmsIndex = (version: string) => `# Laniameda Gallery

> The agent-readable creative vault: media and prompts, reference collections, reusable Skills, native Stories, filter presets, bookmarks and YouTube research.

Read the canonical skill below before using the gallery. Skill version in this deployment: ${version}. Public instructions come from the deployed repository; current private world policy is owner data. Public documentation does not grant access to private gallery data or authorize a write.

Start with the available Gallery MCP at ${GALLERY_SKILL_ORIGIN}/api/mcp and call check_connection. Discover tools and schemas from tools/list. The read-only get_skill_instructions tool fetches this skill and its references using the connector's existing authentication; no token copying is needed. If MCP is unavailable, download the standalone client and run it with Bun and LANIAMEDA_GALLERY_AGENT_TOKEN. Tokens are issued at /agents. Never print tokens or invent owner IDs.

Media, Skills, Stories, bookmarks and YouTube video references are different objects with separate tools. Read only the references needed for the current request. Read Michael's authenticated world rules before filing, selecting references or writing about a world. Read back saved IDs, media, tags and memberships before reporting completion.

## Start here

- [Canonical SKILL.md](${resourceUrl("SKILL.md")}): Current repository-backed skill. Relative references resolve under the same skill directory.
- [Web access and capability limits](${resourceUrl("references/web-access.md")}): Fetch instructions, authentication and which operations are available through MCP.
- [Skill manifest](${resourceUrl("manifest.json")}): Version, SHA-256 fingerprint and resource URLs with public/owner access labels.
- [Standalone MCP client](${resourceUrl("scripts/gallery.mjs")}): Download, then run bun gallery.mjs check; tools; schema <tool>.
- [Importable client](${resourceUrl("scripts/gallery-client.mjs")}): Download for custom Bun scripts that iterate and filter gallery data before printing results.
- [Agent access](${GALLERY_SKILL_ORIGIN}/agents): Owner sign-in and scoped token management.

## Task references

${GALLERY_SKILL_RESOURCES.filter((r) => r.path.startsWith("references/") && r.access === "public" && r.path !== "references/web-access.md").map((r) => `- [${r.title}](${resourceUrl(r.path)}): Fetch for the relevant task.`).join("\n")}

## Owner-only resources

- [World rules](${resourceUrl("references/worlds.md")}): Private policy, style lanes and live IDs. Use get_skill_instructions with resource references/worlds.md, or HTTP Authorization: Bearer with gallery:read. Restricted to this gallery's configured owner and MCP allowlist.
- [Maintenance notes](${resourceUrl("references/maintenance.md")}): Private local/cloud installation and deployment guidance. Same owner authentication, also available through get_skill_instructions.

If an owner-only resource returns 401/403, obtain authorized access; do not reconstruct policy from old memories or guess private IDs. Tool schemas describe supported payloads; Michael's current request determines intent and authorization. Use the live schema when an older direct-script example differs.
`;

export async function galleryLlmsResponse() {
  try {
    const source = await readSource("SKILL.md");
    return new Response(buildGalleryLlmsIndex(sourceVersion(source)), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        Link: `<${GALLERY_SKILL_PATH}/SKILL.md>; rel="describedby"; type="text/markdown"`,
      },
    });
  } catch {
    return Response.json({ error: "Gallery skill source is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function gallerySkillResourceResponse(
  request: Request,
  segments: string[],
  dependencies: Dependencies,
) {
  const path = segments.join("/");
  const resource = GALLERY_SKILL_RESOURCES.find((entry) => entry.path === path);
  if (!resource && path !== "manifest.json") {
    return Response.json({ error: "Unknown gallery skill resource." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  if (resource?.access === "owner") {
    const denied = await dependencies.authorizeOwner(request);
    if (denied) return denied;
  }

  try {
    const read = dependencies.readSource ?? readSource;
    const skill = await read("SKILL.md");
    const version = sourceVersion(skill);
    const source = path === "manifest.json"
      ? JSON.stringify({
        name: "laniameda-gallery",
        version,
        sha256: digest(skill),
        source: "repository:skills/laniameda-gallery",
        skillUrl: resourceUrl("SKILL.md"),
        discoveryUrl: `${GALLERY_SKILL_ORIGIN}/llms.txt`,
        mcpUrl: `${GALLERY_SKILL_ORIGIN}/api/mcp`,
        mcpInstructionTool: "get_skill_instructions",
        resources: GALLERY_SKILL_RESOURCES.map((entry) => ({ ...entry, url: resourceUrl(entry.path), source: entry.access === "owner" ? "owner-data:agentInstructions" : "repository:skills/laniameda-gallery" })),
      }, null, 2)
      : path === "SKILL.md" ? skill : await read(path);
    const isPrivate = resource?.access === "owner";
    const headers = new Headers({
      "Content-Type": path.endsWith(".json") ? "application/json; charset=utf-8" : path.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": isPrivate ? "private, no-store" : "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "X-Gallery-Skill-Version": version,
      "X-Gallery-Resource-Sha256": digest(source),
      Link: '</llms.txt>; rel="describedby"',
    });
    if (isPrivate) {
      headers.set("Vary", "Authorization");
    } else {
      const etag = `"${digest(source)}"`;
      headers.set("ETag", etag);
      headers.set("Access-Control-Allow-Origin", "*");
      if (request.headers.get("if-none-match")?.split(",").some((value) => value.trim().replace(/^W\//, "") === etag || value.trim() === "*")) {
        return new Response(null, { status: 304, headers });
      }
    }
    return new Response(source, { headers });
  } catch {
    return Response.json({ error: "Gallery skill source is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
