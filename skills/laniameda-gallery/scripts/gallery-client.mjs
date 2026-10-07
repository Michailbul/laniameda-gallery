// Scoped Gallery SDK for agent-written local JavaScript. No dependency, eval,
// raw database credentials or server-side arbitrary code execution.
export class GalleryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GalleryError";
    Object.assign(this, details);
  }
}

const decode = (result) => {
  if (!result || typeof result !== "object") throw new GalleryError("Gallery returned no result.");
  if (Array.isArray(result.content)) {
    const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    if (result.isError) throw new GalleryError(text || "Gallery tool failed.", { result });
    try { return JSON.parse(text); } catch { return { text, content: result.content }; }
  }
  return result;
};

/**
 * Use an env-scoped bearer token for HTTP, or supply callTool(name,args) and
 * listTools() bridges from an already-authenticated MCP environment.
 */
export function createGalleryClient(options = {}) {
  const token = options.token ?? globalThis.process?.env?.LANIAMEDA_GALLERY_AGENT_TOKEN;
  const apiUrl = (options.apiUrl ?? globalThis.process?.env?.LANIAMEDA_GALLERY_API_URL ?? "https://gallery.laniameda.space").replace(/\/+$/, "");
  const requestFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const maxCalls = options.maxCalls ?? 1000;
  let calls = 0;
  let requestId = 0;
  let toolCache;
  if (!options.callTool && !token?.trim()) throw new GalleryError("LANIAMEDA_GALLERY_AGENT_TOKEN is required, or provide an authenticated MCP callTool bridge.");
  if (!/^https?:\/\//.test(apiUrl)) throw new GalleryError("Gallery apiUrl must use http or https.");
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new GalleryError("Invalid client call or timeout budget.");

  const budget = () => {
    if (++calls > maxCalls) throw new GalleryError(`Gallery call budget (${maxCalls}) exceeded; traversal is incomplete.`, { incomplete: true });
  };
  const bridge = async operation => {
    let timer;
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new GalleryError("Gallery bridge timed out; write persistence is unknown. Inspect the stable ingestKey before retrying.", { persistenceUnknown: true })), timeoutMs);
      Promise.resolve().then(operation).then(resolve, reject);
    }).finally(() => clearTimeout(timer));
  };
  const rpc = async (method, params) => {
    budget();
    let response;
    try {
      response = await requestFetch(`${apiUrl}/api/mcp`, {
        method: "POST", signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, ...(params ? { params } : {}) }),
      });
    } catch (error) {
      throw new GalleryError("Gallery request did not complete. Write persistence is unknown; inspect the stable ingestKey before retrying.", { cause: error, persistenceUnknown: method === "tools/call" });
    }
    const text = await response.text();
    let parsed;
    try {
      const body = response.headers.get("content-type")?.includes("text/event-stream")
        ? text.split(/\r?\n/).filter(line => line.startsWith("data:")).at(-1)?.slice(5).trim() ?? "{}"
        : text;
      parsed = JSON.parse(body);
    } catch { throw new GalleryError(`Gallery returned an invalid response (HTTP ${response.status}).`, { status: response.status }); }
    if (!response.ok || parsed.error) throw new GalleryError(parsed.error?.message ?? parsed.error ?? `Gallery HTTP ${response.status}`, { status: response.status, result: parsed });
    return parsed.result;
  };
  const call = async (name, args = {}) => {
    let raw;
    if (options.callTool) { budget(); raw = await bridge(() => options.callTool(name, args)); }
    else raw = await rpc("tools/call", { name, arguments: args });
    const result = decode(raw);
    if (result.ok === false) throw new GalleryError(result.error ?? (result.partial ? "Gallery saved a partial result; inspect persisted IDs and failedStep." : "One or more Gallery operations failed."), { result, partial: result.partial === true, persistedIDs: result.persistedIDs });
    return result;
  };
  const discover = async ({ query, includeSchema = false, refresh = false } = {}) => {
    if (!options.listTools && !token?.trim()) throw new GalleryError("Tool discovery requires an authenticated listTools bridge or the scoped token.");
    if (!toolCache || refresh) {
      const tools = [];
      let cursor;
      const seen = new Set();
      do {
        let page;
        if (options.listTools) { budget(); page = await bridge(() => options.listTools(cursor)); }
        else page = await rpc("tools/list", cursor ? { cursor } : undefined);
        tools.push(...(page.tools ?? []));
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new GalleryError("Tool discovery cursor did not advance.");
        seen.add(cursor);
      } while (cursor);
      toolCache = tools;
    }
    const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    return toolCache.filter(tool => terms.every(term => `${tool.name} ${tool.description}`.toLowerCase().includes(term)))
      .map(tool => includeSchema ? tool : { name: tool.name, description: tool.description, annotations: tool.annotations });
  };
  const schema = async name => {
    const found = (await discover({ includeSchema: true })).find(tool => tool.name === name);
    if (!found) throw new GalleryError(`No deployed Gallery tool named ${name}. Refresh the contract before using a new capability.`);
    return found;
  };
  const paged = async function* (tool, key, args = {}, { maxPages = 10_000 } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new GalleryError("maxPages must be a positive integer.");
    let cursor = args.cursor ?? null;
    const seen = new Set();
    for (let index = 0; index < maxPages; index++) {
      const page = await call(tool, { ...args, cursor });
      if (!Array.isArray(page[key]) || typeof page.isDone !== "boolean") throw new GalleryError("Deployed listing lacks the complete pagination contract; update or choose a supported path.", { result: page, incomplete: true });
      yield page;
      if (page.isDone) return;
      if (!page.cursor || page.cursor === cursor || seen.has(page.cursor)) throw new GalleryError("Gallery listing cursor did not advance; traversal is incomplete.", { result: page, incomplete: true });
      cursor = page.cursor;
      seen.add(cursor);
    }
    throw new GalleryError(`Gallery page budget (${maxPages}) exceeded; traversal is incomplete.`, { incomplete: true });
  };
  const inventory = async (tool, key, args, limits) => {
    if (args?.cursor) throw new GalleryError("Complete inventory must start without a cursor; use pages() to resume a partial traversal.", { incomplete: true });
    const rows = new Map();
    let pageCount = 0;
    let scannedCount = 0;
    let order;
    for await (const page of paged(tool, key, args, limits)) {
      pageCount++; scannedCount += page.scannedCount ?? page[key].length; order = page.order;
      for (const item of page[key]) {
        const id = item._id ?? item.id;
        if (typeof id !== "string" || !id) throw new GalleryError("Gallery inventory row has no stable ID; traversal is incomplete.", { result: item, incomplete: true });
        rows.set(id, item);
      }
    }
    return { complete: true, [key]: [...rows.values()], pageCount, scannedCount, order, filters: args ?? {} };
  };
  const named = name => args => call(name, args);
  const byId = name => (id, fields = {}) => call(name, { id, ...fields });
  const client = {
    call, discover, schema, contract: () => call("get_gallery_contract"), instructions: resource => call("get_skill_instructions", resource ? { resource } : {}),
    usage: () => ({ calls, maxCalls }),
    assets: {
      list: named("list_assets"), page: named("list_assets_page"), pages: (args, limits) => paged("list_assets_page", "assets", args, limits),
      inventory: (args, limits) => inventory("list_assets_page", "assets", args, limits),
      all: async (args, limits) => (await inventory("list_assets_page", "assets", args, limits)).assets,
      get: id => call("get_gallery_item", { id: id.includes(":") ? id : `asset:${id}` }),
      search: (query, filters = {}) => call("search_gallery", { query, ...filters }), similar: byId("find_similar"),
      save: named("save_asset"), saveMany: items => call("save_assets", { items }), update: named("update_gallery_item"), delete: named("delete_gallery_item"),
      setPoster: (assetId, posterUploadId) => call("set_video_poster", { assetId, posterUploadId }),
    },
    collections: { list: named("list_collections"), create: named("create_collection"), update: named("update_collection"), setOption: named("set_collection_option"), delete: folderId => call("delete_collection", { folderId }) },
    menuFilters: { list: named("list_menu_filters") },
    tags: { list: named("list_tags"), upsert: named("upsert_tag"), upsertMany: named("upsert_tags"), archive: named("archive_tag"), aliases: named("add_tag_aliases") },
    skills: { list: named("list_skills"), get: byId("get_skill"), search: named("search_skills"), create: named("create_skill"), update: named("update_skill"), file: named("file_skill"), delete: byId("delete_skill") },
    stories: { list: named("list_stories"), get: byId("get_story"), save: named("save_story"), update: named("update_story"), revisions: byId("get_story_revisions"), delete: byId("delete_story") },
    presets: { list: named("list_filter_presets"), save: named("save_filter_preset"), delete: byId("delete_filter_preset") },
    bookmarks: { list: named("list_bookmarks"), save: named("save_bookmarks"), setNote: named("set_bookmark_note") },
    videoRefs: {
      list: named("list_video_refs"), page: named("list_video_refs_page"), pages: (args, limits) => paged("list_video_refs_page", "videos", args, limits),
      inventory: (args, limits) => inventory("list_video_refs_page", "videos", args, limits), all: async (args, limits) => (await inventory("list_video_refs_page", "videos", args, limits)).videos,
      get: byId("get_video_ref"), save: named("save_video_refs"), update: named("update_video_ref"), delete: byId("delete_video_ref"),
    },
    uploads: { prepare: named("prepare_uploads") },
  };
  return client;
}
