import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GALLERY_SKILL_RESOURCES, buildGalleryLlmsIndex, gallerySkillResourceResponse, isGallerySkillOwner } from "../lib/server/gallery-skill-resources";

const request = (path: string, headers?: HeadersInit) => new Request(`https://gallery.laniameda.space/skills/laniameda-gallery/${path}`, { headers });
const permit = { authorizeOwner: async () => null };

describe("website gallery skill discovery", () => {
  test("private world policy belongs to the configured gallery owner", () => {
    expect(isGallerySkillOwner("telegram:12345", "12345")).toBe(true);
    expect(isGallerySkillOwner("12345", "telegram:12345")).toBe(true);
    expect(isGallerySkillOwner("telegram:98765", "12345")).toBe(false);
    expect(isGallerySkillOwner("12345", undefined)).toBe(false);
  });

  test("all advertised resources exist in the canonical source", async () => {
    for (const resource of GALLERY_SKILL_RESOURCES) {
      const source = await readFile(join(process.cwd(), "skills/laniameda-gallery", resource.path), "utf8");
      expect(source.length).toBeGreaterThan(0);
    }
  });

  test("llms index provides a small startup path and task links", () => {
    const index = buildGalleryLlmsIndex("1.5.0");
    expect(index.startsWith("# Laniameda Gallery\n\n>")).toBe(true);
    expect(index).toContain("/SKILL.md");
    expect(index).toContain("/manifest.json");
    expect(index).toContain("check_connection");
    expect(index).toContain("Owner-only resources");
    expect(index).toContain("gallery:read");
    expect(index).toContain("1.5.0");
  });

  test("SKILL.md is the exact canonical file, with version and revalidation", async () => {
    const response = await gallerySkillResourceResponse(request("SKILL.md"), ["SKILL.md"], { authorizeOwner: async () => { throw Error("Public resource requested authentication"); } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(await readFile(join(process.cwd(), "skills/laniameda-gallery/SKILL.md"), "utf8"));
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("cache-control")).toContain("must-revalidate");
    expect(response.headers.get("x-gallery-skill-version")).toBe("1.5.0");
    expect(response.headers.get("etag")).toBeTruthy();
  });

  test("manifest fingerprints the deployed source and marks private resources", async () => {
    const response = await gallerySkillResourceResponse(request("manifest.json"), ["manifest.json"], permit);
    const manifest = await response.json();
    const source = await readFile(join(process.cwd(), "skills/laniameda-gallery/SKILL.md"), "utf8");
    expect(manifest.sha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(manifest.resources.find((r: { path: string }) => r.path === "references/worlds.md").access).toBe("owner");
  });

  test("private sources are never read when authentication denies access", async () => {
    let read = false;
    const response = await gallerySkillResourceResponse(request("references/worlds.md"), ["references", "worlds.md"], {
      authorizeOwner: async () => new Response("Denied", { status: 401 }),
      readSource: async () => { read = true; return "private"; },
    });
    expect(response.status).toBe(401);
    expect(read).toBe(false);
  });

  test("authenticated private references are not cached or made public by CORS", async () => {
    const response = await gallerySkillResourceResponse(request("references/worlds.md"), ["references", "worlds.md"], permit);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("etag")).toBe(false);
  });

  test("unknown paths and traversal cannot open arbitrary repository files", async () => {
    for (const segments of [["..", ".env.local"], ["scripts", "ingest.ts"], ["references", "..", "..", "..", ".env"], ["references/worlds.md/extra"]]) {
      const response = await gallerySkillResourceResponse(request(segments.join("/")), segments, { authorizeOwner: async () => { throw Error("Unknown resource requested authentication"); }, readSource: async () => { throw Error("Unknown file was read"); } });
      expect(response.status).toBe(404);
    }
  });

  test("conditional requests track source changes instead of a stale public copy", async () => {
    let source = "---\nversion: 1.5.0\n---\nFirst";
    const dependencies = { ...permit, readSource: async () => source };
    const first = await gallerySkillResourceResponse(request("SKILL.md"), ["SKILL.md"], dependencies);
    const etag = first.headers.get("etag")!;
    const same = await gallerySkillResourceResponse(request("SKILL.md", { "if-none-match": etag }), ["SKILL.md"], dependencies);
    expect(same.status).toBe(304);
    source += "\nUpdated";
    const changed = await gallerySkillResourceResponse(request("SKILL.md", { "if-none-match": etag }), ["SKILL.md"], dependencies);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });

  test("unavailable sources return a generic error without filesystem details", async () => {
    const response = await gallerySkillResourceResponse(request("SKILL.md"), ["SKILL.md"], { ...permit, readSource: async () => { throw Error("/private/path/.env.local"); } });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("/private/path");
  });
});
