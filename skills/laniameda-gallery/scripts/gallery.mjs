#!/usr/bin/env bun

// The gallery's hosted MCP tools from a shell, for sessions that have no
// gallery MCP server configured (cloud sandboxes, CI, a fresh machine).
// No dependencies: Bun, plus a gallery agent token.
//
//   bun gallery.mjs check                     # reads token from the environment
//   bun gallery.mjs tools                     # tool names and one-line summaries
//   bun gallery.mjs schema save_assets        # one tool's full input schema
//   bun gallery.mjs search_gallery '{"query":"rainy street at night","limit":8}'
//   bun gallery.mjs preview_assets '{"query":"clay character"}' --out ./previews
//   bun gallery.mjs save_assets @items.json   # arguments from a file, or "-" for stdin
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
  all_assets '<json>'   complete asset inventory; --out dir saves assets.json. Without
                        filters it downloads the cached export (rebuilt at most daily;
                        {"refresh":true} rebuilds, {"maxAgeMinutes":60} tightens it,
                        {"live":true} pages the live table). Filters page live.
  all_video_refs '<json>'  traverse YouTube research; --out dir saves videos.json
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
      signal: AbortSignal.timeout(300_000),
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

// Plain REST call to an /api/agent route with the same bearer token.
const agentPost = async (path, body) => {
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify(body),
    });
  } catch (error) {
    fail(`Cannot reach ${apiUrl} (${error.cause?.code ?? error.message}).`);
  }
  if (response.status === 401) fail("The gallery refused the token (401). Check LANIAMEDA_GALLERY_AGENT_TOKEN.");
  return response;
};

// The cached export: one status call, then each part once. A rebuild between
// calls (409) restarts the download so parts never mix two snapshots.
const exportedInventory = async ({ refresh, maxAgeMinutes }) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const statusResponse = await agentPost("/api/agent/inventory", {
      action: "status", ...(refresh ? { refresh: true } : {}), ...(maxAgeMinutes ? { maxAgeMinutes } : {}),
    });
    const status = await statusResponse.json().catch(() => ({}));
    // A deployment without the export (or with it failing) still answers
    // with a complete live traversal.
    if (!statusResponse.ok || !Array.isArray(status.parts) || typeof status.generatedAt !== "number") {
      process.stderr.write(`Inventory export unavailable (${status.error ?? `HTTP ${statusResponse.status}`}); paging the live table instead.\n`);
      return null;
    }
    const rows = new Map();
    let folders = [];
    let restarted = false;
    for (const part of status.parts) {
      const response = await agentPost("/api/agent/inventory", { action: "part", generatedAt: status.generatedAt, index: part.index });
      if (response.status === 409) { restarted = true; break; }
      if (!response.ok) fail(`Inventory part ${part.index} failed (HTTP ${response.status}); the download is incomplete.`);
      const body = await response.json();
      if (!Array.isArray(body.assets) || body.assets.length !== part.count) fail(`Inventory part ${part.index} is incomplete.`);
      if (Array.isArray(body.folders)) folders = body.folders;
      for (const asset of body.assets) rows.set(asset._id, asset);
    }
    if (restarted) continue;
    if (rows.size !== status.assetCount) fail("Inventory export count does not match its parts; the download is incomplete.");
    // Assets saved after the snapshot lead, newest first.
    const newer = (status.newerAssets ?? []).filter((asset) => !rows.has(asset._id));
    return {
      complete: true, source: "export", generatedAt: new Date(status.generatedAt).toISOString(),
      ageMinutes: status.ageMinutes, rebuilt: status.rebuilt, count: rows.size + newer.length,
      newerSinceExport: newer.length,
      note: "Snapshot plus assets saved since. Edits and deletions after generatedAt are not reflected; pass {\"refresh\":true} or read single records with get_gallery_item before acting on them.",
      folders, assets: [...newer, ...rows.values()],
    };
  }
  fail("The inventory export kept changing while downloading; try again.");
};

const writeInventory = (inventory, key, outDir, extra = {}) => {
  if (outDir) {
    const dir = resolve(outDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${key}.json`);
    writeFileSync(path, JSON.stringify(inventory, null, 2));
    process.stdout.write(`${JSON.stringify({ complete: true, source: inventory.source, count: inventory.count, ...extra, file: path })}\n`);
  } else process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
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
  let failed = result.isError === true;
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      process.stdout.write(`${block.text}\n`);
      try { if (JSON.parse(block.text)?.ok === false) failed = true; } catch { /* Plain-text results are valid. */ }
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
  if (failed) process.exit(1);
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

  if (command === "all_assets") {
    const { refresh, maxAgeMinutes, live, ...rest } = readArguments(rawArguments);
    // A page budget or any filter asks for a live traversal; pageSize alone does not.
    const { pageSize: _pageSize, ...filters } = rest;
    if (!live && Object.keys(filters).length === 0) {
      const inventory = await exportedInventory({ refresh, maxAgeMinutes });
      if (inventory) {
        writeInventory(inventory, "assets", outDir);
        return;
      }
    }
  }

  if (command === "all_assets" || command === "all_video_refs") {
    const { maxPages = 10000, live: _live, refresh: _refresh, maxAgeMinutes: _maxAge, ...filters } = readArguments(rawArguments);
    if (!Number.isInteger(maxPages) || maxPages < 1) fail("maxPages must be a positive integer.", 2);
    if (filters.cursor) fail("Complete inventory must start without a cursor; call a page tool to resume partial traversal.", 2);
    const tool = command === "all_assets" ? "list_assets_page" : "list_video_refs_page";
    const key = command === "all_assets" ? "assets" : "videos";
    const rows = new Map();
    const cursors = new Set();
    let cursor = filters.cursor ?? null;
    let pages = 0;
    let scanned = 0;
    let order;
    let isDone = false;
    while (!isDone && pages < maxPages) {
      const result = await rpc("tools/call", { name: tool, arguments: { ...filters, cursor } });
      if (result.isError) { printToolResult(tool, result, outDir); return; }
      let page;
      try { page = JSON.parse(result.content.find(block => block.type === "text")?.text ?? "{}"); }
      catch { fail("Gallery page was not JSON; traversal is incomplete."); }
      if (!Array.isArray(page[key]) || typeof page.isDone !== "boolean") fail("Deployed gallery does not support this complete pagination contract; traversal is incomplete.");
      pages++; scanned += page.scannedCount ?? page[key].length; order = page.order;
      for (const item of page[key]) {
        if (!item._id) fail("Gallery row has no stable ID; traversal is incomplete.");
        rows.set(item._id, item);
      }
      isDone = page.isDone;
      if (!isDone && (!page.cursor || page.cursor === cursor || cursors.has(page.cursor))) fail("Gallery cursor did not advance; traversal is incomplete.");
      cursor = page.cursor;
      cursors.add(cursor);
    }
    if (!isDone) fail(`maxPages (${maxPages}) reached; traversal is incomplete.`);
    const inventory = { complete: true, source: "live", count: rows.size, pages, scannedCount: scanned, order, filters, [key]: [...rows.values()] };
    writeInventory(inventory, key, outDir, { pages });
    return;
  }

  const tool = command === "check" ? "check_connection" : command;
  const result = await rpc("tools/call", { name: tool, arguments: readArguments(rawArguments) });
  printToolResult(tool, result, outDir);
};

await main();
