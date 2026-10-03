#!/usr/bin/env node

// The gallery's hosted MCP tools from a shell, for sessions that have no
// gallery MCP server configured (cloud sandboxes, CI, a fresh machine).
// No dependencies: Node 18+ or bun, plus a gallery agent token.
//
//   LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... node gallery.mjs check
//   node gallery.mjs tools                      # tool names and one-line summaries
//   node gallery.mjs schema save_assets         # one tool's full input schema
//   node gallery.mjs search_gallery '{"query":"rainy street at night","limit":8}'
//   node gallery.mjs preview_assets '{"query":"clay character"}' --out ./previews
//   node gallery.mjs save_assets @items.json    # arguments from a file, or "-" for stdin
//
// Same tools, same server-side rules as the MCP connector: this speaks MCP
// (Streamable HTTP, stateless) to <api url>/api/mcp with the token as a bearer.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_API_URL = "https://gallery.laniameda.space";
const PROTOCOL_VERSION = "2025-06-18";

const USAGE = `Usage: gallery.mjs <command> [json | @file | -] [--out <dir>]

  check                 verify the token (same as the check_connection tool)
  tools                 list every tool with a one-line summary
  schema <tool>         print one tool's input schema
  <tool> '<json>'       call a tool; arguments as JSON, @file.json, or - for stdin

Env:
  LANIAMEDA_GALLERY_AGENT_TOKEN   required, an lgat_ token from /agents
  LANIAMEDA_GALLERY_API_URL       optional, default ${DEFAULT_API_URL}

--out <dir>   where image results (preview_assets contact sheets) are written;
              default is a laniameda-gallery folder in the system temp dir.`;

const fail = (message, code = 1) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const parseArgv = (argv) => {
  const positional = [];
  let outDir;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      outDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--out=")) {
      outDir = arg.slice("--out=".length);
    } else {
      positional.push(arg);
    }
  }
  return { positional, outDir };
};

const readArguments = (raw) => {
  if (raw === undefined || raw === "") return {};
  const text =
    raw === "-" ? readFileSync(0, "utf8") : raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`Tool arguments must be a JSON object: ${error.message}`, 2);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Tool arguments must be a JSON object.", 2);
  }
  return parsed;
};

const apiUrl = (process.env.LANIAMEDA_GALLERY_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
const token = (process.env.LANIAMEDA_GALLERY_AGENT_TOKEN || "").trim();

// The server answers JSON; an SSE body is tolerated in case that changes.
const parseBody = (text, contentType) => {
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  return JSON.parse(data[data.length - 1] ?? "{}");
};

let requestId = 0;
const rpc = async (method, params) => {
  requestId += 1;
  let response;
  try {
    response = await fetch(`${apiUrl}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, ...(params ? { params } : {}) }),
    });
  } catch (error) {
    fail(
      `Cannot reach ${apiUrl} (${error.cause?.code ?? error.message}). ` +
        "In a cloud sandbox, add the gallery host to the environment's allowed network domains.",
    );
  }

  const text = await response.text();
  if (response.status === 401) {
    fail("The gallery refused the token (401). Check LANIAMEDA_GALLERY_AGENT_TOKEN; it may be revoked or expired.");
  }
  if (response.status === 403) {
    fail("This token's owner may not use the gallery MCP (403).");
  }

  let body;
  try {
    body = parseBody(text, response.headers.get("content-type") ?? "");
  } catch {
    fail(`Unexpected reply from ${apiUrl}/api/mcp (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  if (body.error) {
    fail(`${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result;
};

const listTools = async () => {
  const tools = [];
  let cursor;
  do {
    const page = await rpc("tools/list", cursor ? { cursor } : undefined);
    tools.push(...(page.tools ?? []));
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
};

const firstSentence = (text = "") => {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/\.(\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
};

const EXTENSION_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const printToolResult = (tool, result, outDir) => {
  let imageCount = 0;
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      process.stdout.write(`${block.text}\n`);
    } else if (block.type === "image" && block.data) {
      const dir = resolve(outDir ?? join(tmpdir(), "laniameda-gallery"));
      mkdirSync(dir, { recursive: true });
      imageCount += 1;
      const extension = EXTENSION_BY_MIME[block.mimeType] ?? "bin";
      const file = join(dir, `${tool}-${Date.now()}-${imageCount}.${extension}`);
      writeFileSync(file, Buffer.from(block.data, "base64"));
      // Read this file to look at the sheet; the legend is in the text above.
      process.stdout.write(`${JSON.stringify({ image: file, mimeType: block.mimeType })}\n`);
    }
  }
  if (result.isError) process.exit(1);
};

const main = async () => {
  const { positional, outDir } = parseArgv(process.argv.slice(2));
  const [command, rawArguments] = positional;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!token) {
    fail(
      "LANIAMEDA_GALLERY_AGENT_TOKEN is not set. Michael issues gallery tokens on /agents; " +
        "in a cloud session it belongs in the environment's variables. Ask him for it, do not guess one.",
      2,
    );
  }

  if (command === "tools") {
    for (const tool of await listTools()) {
      process.stdout.write(`${tool.name}\t${firstSentence(tool.description)}\n`);
    }
    return;
  }

  if (command === "schema") {
    const name = rawArguments;
    if (!name) fail("Usage: gallery.mjs schema <tool>", 2);
    const tool = (await listTools()).find((entry) => entry.name === name);
    if (!tool) fail(`No such tool: ${name}. Run "gallery.mjs tools".`, 2);
    process.stdout.write(
      `${JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }, null, 2)}\n`,
    );
    return;
  }

  const tool = command === "check" ? "check_connection" : command;
  const result = await rpc("tools/call", { name: tool, arguments: readArguments(rawArguments) });
  printToolResult(tool, result, outDir);
};

await main();
