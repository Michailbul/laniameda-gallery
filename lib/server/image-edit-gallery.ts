import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AGENT_ROUTES } from "./mcp-agent-routes";
import { withExtensionGalleryReader } from "./agent-auth";
import { registerGalleryTools } from "@/mcp/laniameda-gallery/tools";

// The actual MCP registrations, schemas and handlers. No copied API schemas,
// writes, uploads or paid generation are exposed to the editing conversation.
const READ_TOOLS = new Set(["get_skill_instructions", "open_world", "list_styles", "get_style", "get_story", "get_gallery_item",
  "list_characters", "get_character", "list_collections", "search_gallery", "find_assets", "get_moodboard", "list_moodboards", "search_skills", "get_skill"]);

export async function imageEditGallery(request: Request, call?: { name: string; arguments: Record<string, unknown> }) {
  return withExtensionGalleryReader(request, async () => {
    const server = new McpServer({ name: "image-edit-reader", version: "1" });
    registerGalleryTools(server, { apiUrl: new URL(request.url).origin, onlyTools: READ_TOOLS,
      apiFetch: async (path, body) => {
        const handler = AGENT_ROUTES[path];
        if (!handler) throw new Error("Unknown gallery route.");
        const response = await handler(new Request(new URL(path, request.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The gallery could not read that.");
        return result;
      } });
    const client = new Client({ name: "image-edit-chat", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      if (!call) return (await client.listTools()).tools;
      if (!READ_TOOLS.has(call.name)) throw new Error("Gallery chat only has reading access.");
      const result = await client.callTool(call);
      return result;
    } finally { await client.close(); await server.close(); }
  });
}
