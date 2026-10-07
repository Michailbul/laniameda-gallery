import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../skills/laniameda-gallery/scripts/gallery.mjs");
describe("standalone Bun inventory CLI", () => {
  test("complete commands reject a starting cursor before any remote call", async () => {
    for (const command of ["all_assets", "all_video_refs"]) {
      const child = Bun.spawn([process.execPath, script, command, '{"cursor":"middle"}'], { env: { ...process.env, LANIAMEDA_GALLERY_AGENT_TOKEN: "test-token", LANIAMEDA_GALLERY_API_URL: "http://localhost:1" }, stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(2);
      expect(await new Response(child.stdout).text()).toBe("");
      expect(await new Response(child.stderr).text()).toContain("Complete inventory must start without a cursor");
    }
  });
  test("follows empty video pages and writes a labelled complete scoped export", async () => {
    const output = await mkdtemp(join(tmpdir(), "gallery-cli-test-"));
    const server = Bun.serve({ port: 0, fetch: async request => {
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
      const rpc = await request.json();
      expect(rpc.params.name).toBe("list_video_refs_page");
      const first = !rpc.params.arguments.cursor;
      const page = { videos: first ? [] : [{ _id: "video-1", title: "Research" }], cursor: first ? "next" : null, isDone: !first, scannedCount: 1, order: "owner-candidate-createdAt-desc" };
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(page) }] } });
    } });
    try {
      const child = Bun.spawn([process.execPath, script, "all_video_refs", '{"language":"en"}', "--out", output], { env: { ...process.env, LANIAMEDA_GALLERY_AGENT_TOKEN: "test-token", LANIAMEDA_GALLERY_API_URL: `http://localhost:${server.port}` }, stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(0);
      const summary = JSON.parse(await new Response(child.stdout).text());
      expect(summary).toMatchObject({ complete: true, count: 1, pages: 2, file: join(output, "videos.json") });
      expect(JSON.parse(await readFile(summary.file, "utf8"))).toMatchObject({ complete: true, filters: { language: "en" }, scannedCount: 2, videos: [{ _id: "video-1" }] });
    } finally { server.stop(); await rm(output, { recursive: true, force: true }); }
  });
  test("budget exhaustion exits nonzero without publishing a complete inventory", async () => {
    const server = Bun.serve({ port: 0, fetch: async request => {
      const rpc = await request.json();
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ assets: [], cursor: "next", isDone: false }) }] } });
    } });
    try {
      const child = Bun.spawn([process.execPath, script, "all_assets", '{"maxPages":1}'], { env: { ...process.env, LANIAMEDA_GALLERY_AGENT_TOKEN: "test-token", LANIAMEDA_GALLERY_API_URL: `http://localhost:${server.port}` }, stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stdout).text()).toBe("");
      expect(await new Response(child.stderr).text()).toContain("traversal is incomplete");
    } finally { server.stop(); }
  });
});
