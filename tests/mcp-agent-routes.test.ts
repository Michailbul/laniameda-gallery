import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Every /api/agent/* path an MCP tool calls must be routed in-process by the
// hosted MCP (lib/server/mcp-agent-routes.ts); a missing entry answers
// "Unknown gallery API path" in production while local tests stay green.
test("every agent API path the MCP tools call is in AGENT_ROUTES", () => {
  const tools = readFileSync(new URL("../mcp/laniameda-gallery/tools.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../lib/server/mcp-agent-routes.ts", import.meta.url), "utf8");
  const called = new Set([...tools.matchAll(/"(\/api\/agent\/[a-z/-]+)"/g)].map((match) => match[1]));
  const routed = new Set([...routes.matchAll(/^\s+"(\/api\/agent\/[a-z/-]+)":/gm)].map((match) => match[1]));
  expect(called.size).toBeGreaterThan(5);
  expect([...called].filter((path) => !routed.has(path))).toEqual([]);
});
