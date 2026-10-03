import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// skills/laniameda-gallery/scripts/gallery.mjs is what a cloud session with no
// MCP client runs, so it is exercised as a real subprocess against a stand-in
// for /api/mcp.

const SCRIPT = join(import.meta.dir, "..", "skills", "laniameda-gallery", "scripts", "gallery.mjs");
const TOKEN = "lgat_test-token";
const PIXEL = Buffer.from("fake-jpeg-bytes").toString("base64");

const TOOLS = [
  {
    name: "check_connection",
    description: "Verify the connection. Second sentence.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_gallery",
    description: "Search the gallery.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
];

let server: ReturnType<typeof Bun.serve>;
const seen: { authorization: string | null; body: Record<string, unknown> }[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/api/mcp" || request.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const authorization = request.headers.get("authorization");
      const body = (await request.json()) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      seen.push({ authorization, body });
      if (authorization !== `Bearer ${TOKEN}`) {
        return Response.json({ error: "invalid_token" }, { status: 401 });
      }
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
      if (body.method === "tools/list") return reply({ tools: TOOLS });
      if (body.method === "tools/call") {
        const name = body.params?.name;
        if (name === "check_connection") {
          return reply({ content: [{ type: "text", text: '{"ok":true,"authenticated":true}' }] });
        }
        if (name === "search_gallery") {
          return reply({
            content: [{ type: "text", text: JSON.stringify({ echoed: body.params?.arguments }) }],
          });
        }
        if (name === "preview_assets") {
          return reply({
            content: [
              { type: "text", text: "1. asset:abc" },
              { type: "image", data: PIXEL, mimeType: "image/jpeg" },
            ],
          });
        }
        if (name === "delete_gallery_item") {
          return reply({ isError: true, content: [{ type: "text", text: "Not found." }] });
        }
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: `Tool ${name} not found` },
        });
      }
      return new Response("bad request", { status: 400 });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

const run = async (args: string[], env: Record<string, string | undefined> = {}, stdin?: string) => {
  const child = Bun.spawn(["bun", SCRIPT, ...args], {
    env: {
      PATH: process.env.PATH,
      LANIAMEDA_GALLERY_API_URL: `http://localhost:${server.port}`,
      LANIAMEDA_GALLERY_AGENT_TOKEN: TOKEN,
      ...env,
    } as Record<string, string>,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
};

describe("gallery.mjs", () => {
  test("check calls check_connection with the bearer token", async () => {
    const result = await run(["check"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, authenticated: true });
    const last = seen[seen.length - 1];
    expect(last.authorization).toBe(`Bearer ${TOKEN}`);
    expect(last.body).toMatchObject({
      method: "tools/call",
      params: { name: "check_connection", arguments: {} },
    });
  });

  test("tools lists names with a one-sentence summary", async () => {
    const result = await run(["tools"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      "check_connection\tVerify the connection.\nsearch_gallery\tSearch the gallery.\n",
    );
  });

  test("schema prints one tool's input schema", async () => {
    const result = await run(["schema", "search_gallery"]);
    expect(JSON.parse(result.stdout).inputSchema.properties.query).toEqual({ type: "string" });
    const missing = await run(["schema", "nope"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("No such tool");
  });

  test("passes JSON arguments inline, from a file and from stdin", async () => {
    const inline = await run(["search_gallery", '{"query":"rain","limit":2}']);
    expect(JSON.parse(inline.stdout)).toEqual({ echoed: { query: "rain", limit: 2 } });

    const dir = mkdtempSync(join(tmpdir(), "gallery-cli-"));
    const file = join(dir, "args.json");
    await Bun.write(file, '{"query":"from file"}');
    const fromFile = await run(["search_gallery", `@${file}`]);
    expect(JSON.parse(fromFile.stdout)).toEqual({ echoed: { query: "from file" } });

    const fromStdin = await run(["search_gallery", "-"], {}, '{"query":"from stdin"}');
    expect(JSON.parse(fromStdin.stdout)).toEqual({ echoed: { query: "from stdin" } });
  });

  test("writes image results to --out and prints the path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gallery-cli-out-"));
    const result = await run(["preview_assets", '{"query":"clay"}', "--out", dir]);
    expect(result.code).toBe(0);
    const [legend, pointer] = result.stdout.trim().split("\n");
    expect(legend).toBe("1. asset:abc");
    const { image, mimeType } = JSON.parse(pointer);
    expect(mimeType).toBe("image/jpeg");
    expect(readdirSync(dir)).toHaveLength(1);
    expect(readFileSync(image).toString()).toBe("fake-jpeg-bytes");
  });

  test("fails without a token, and never calls the server", async () => {
    const before = seen.length;
    const result = await run(["check"], { LANIAMEDA_GALLERY_AGENT_TOKEN: "" });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("LANIAMEDA_GALLERY_AGENT_TOKEN is not set");
    expect(seen.length).toBe(before);
  });

  test("reports a refused token without echoing it", async () => {
    const result = await run(["check"], { LANIAMEDA_GALLERY_AGENT_TOKEN: "lgat_wrong-secret" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("401");
    expect(result.stderr + result.stdout).not.toContain("lgat_wrong-secret");
  });

  test("exits non-zero on bad JSON, protocol errors and tool errors", async () => {
    const badJson = await run(["search_gallery", "{nope"]);
    expect(badJson.code).toBe(2);

    const unknown = await run(["nope", "{}"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Tool nope not found");

    const toolError = await run(["delete_gallery_item", '{"id":"x"}']);
    expect(toolError.code).toBe(1);
    expect(toolError.stdout).toContain("Not found.");
  });

  test("explains an unreachable host", async () => {
    const result = await run(["check"], { LANIAMEDA_GALLERY_API_URL: "http://127.0.0.1:1" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("allowed network domains");
  });
});
