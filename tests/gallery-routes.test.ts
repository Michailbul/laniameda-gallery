import { describe, expect, test } from "bun:test";

import {
  collectionPageUrl,
  collectionRoute,
  galleryPageUrl,
  galleryRoutePath,
  galleryRouteTitle,
  isGalleryPath,
  parseGalleryRoute,
  resolveWorldSegment,
  type GalleryRoute,
} from "@/lib/gallery-routes";

const folders = [
  { _id: "j57root", name: "DEAR ANNETE", worldKey: "dear-annete", slug: "dear-annete-film" },
  { _id: "j57art", name: "ART" },
  { _id: "j57shelf", name: "Cast", parentFolderId: "j57root" },
  { _id: "j57plate", name: "Plates", parentFolderId: "j57art" },
];

describe("gallery routes", () => {
  test("every view round-trips through its path", () => {
    const routes: GalleryRoute[] = [
      { kind: "home" },
      { kind: "collections" },
      { kind: "world", world: "dear-annete" },
      { kind: "world", world: "dear-annete", shelf: "j57shelf" },
      { kind: "world", world: "dear-annete", tab: "instructions" },
      { kind: "world", world: "j57art", tab: "journal" },
      { kind: "world", world: "dear-annete", tab: "tasks" },
      { kind: "world", world: "dear-annete", tab: "moodboards" },
      { kind: "world", world: "dear-annete", tab: "folders" },
      { kind: "storybooks" },
      { kind: "storybooks", id: "j57book" },
      { kind: "moodboards", id: "j57board" },
      { kind: "stories", id: "j57story" },
      { kind: "skills", id: "j57skill" },
      { kind: "bookmarks" },
      { kind: "motion" },
      { kind: "cinematography" },
    ];
    for (const route of routes) {
      const path = galleryRoutePath(route);
      expect(parseGalleryRoute(path)).toEqual({ route, asset: undefined });
    }
  });

  test("the detail panel rides along as ?asset=, with or without the asset: prefix", () => {
    expect(galleryRoutePath({ kind: "world", world: "dear-annete" }, "j57pic")).toBe("/w/dear-annete?asset=j57pic");
    expect(parseGalleryRoute("/w/dear-annete", "?asset=asset%3Aj57pic")).toEqual({
      route: { kind: "world", world: "dear-annete" },
      asset: "j57pic",
    });
    expect(parseGalleryRoute("/", "asset=j57pic&tgAuthError=x")?.asset).toBe("j57pic");
  });

  test("agent handles in path segments are accepted and stripped", () => {
    expect(parseGalleryRoute("/moodboards/moodboard:j57board")?.route).toEqual({ kind: "moodboards", id: "j57board" });
    expect(parseGalleryRoute("/w/collection:j57root/docs")?.route).toEqual({ kind: "world", world: "j57root", tab: "instructions" });
  });

  test("other pages are not gallery views", () => {
    for (const path of ["/inbox", "/inbox/j57root/stack", "/youtube", "/tasks", "/misha.buloy/selected_work/featured", "/w", "/w/a/b/c", "/storybooks/a/b", "/api/agent/worlds"]) {
      expect(parseGalleryRoute(path)).toBeNull();
      expect(isGalleryPath(path)).toBe(false);
    }
    expect(isGalleryPath("/w/dear-annete/j57shelf")).toBe(true);
  });

  test("a /w segment resolves a root by world key, public slug or id, and a child by id", () => {
    expect(resolveWorldSegment(folders, "dear-annete")?._id).toBe("j57root");
    expect(resolveWorldSegment(folders, "Dear-Annete-Film")?._id).toBe("j57root");
    expect(resolveWorldSegment(folders, "j57art")?._id).toBe("j57art");
    expect(resolveWorldSegment(folders, "collection:j57shelf")?._id).toBe("j57shelf");
    expect(resolveWorldSegment(folders, "nope")).toBeUndefined();
  });

  test("collections link by world key when marked, by id otherwise", () => {
    expect(collectionRoute(folders, folders[0])).toEqual({ kind: "world", world: "dear-annete" });
    expect(collectionRoute(folders, folders[2])).toEqual({ kind: "world", world: "dear-annete", shelf: "j57shelf" });
    expect(collectionPageUrl(folders, folders[3])).toBe("https://gallery.laniameda.space/w/j57art/j57plate");
    expect(galleryPageUrl({ kind: "stories", id: "j57story" })).toBe("https://gallery.laniameda.space/stories/j57story");
  });

  test("tab titles name the view", () => {
    expect(galleryRouteTitle({ kind: "home" })).toBe("Main Gallery · Laniameda");
    expect(galleryRouteTitle({ kind: "world", world: "dear-annete", shelf: "x" }, { world: "DEAR ANNETE", shelf: "Cast" })).toBe("Cast · DEAR ANNETE · Laniameda");
    expect(galleryRouteTitle({ kind: "world", world: "dear-annete", tab: "journal" }, { world: "DEAR ANNETE" })).toBe("Journal · DEAR ANNETE · Laniameda");
    expect(galleryRouteTitle({ kind: "moodboards", id: "b" }, { item: "Golden" })).toBe("Golden · Moodboards · Laniameda");
  });
});
