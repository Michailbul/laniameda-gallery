import { expect, test } from "bun:test";

import {
  resolveAccessibleGalleryScope,
  resolveScopeFolderFilter,
  shouldShowFolderFilters,
} from "../lib/gallery-filters";

test("resolveAccessibleGalleryScope keeps public selected for users with gallery access", () => {
  expect(
    resolveAccessibleGalleryScope({
      galleryScope: "public",
      canAccessMyGallery: true,
    }),
  ).toBe("public");
});

test("resolveAccessibleGalleryScope falls back to public when mine is inaccessible", () => {
  expect(
    resolveAccessibleGalleryScope({
      galleryScope: "mine",
      canAccessMyGallery: false,
    }),
  ).toBe("public");
});

test("resolveScopeFolderFilter clears an unrestricted folder filter in public scope", () => {
  expect(
    resolveScopeFolderFilter({
      galleryScope: "public",
      selectedFolderId: "folder-1",
      knownFolderIds: null,
    }),
  ).toBeNull();
});

test("resolveScopeFolderFilter allows public scope folder ids from a curated allowlist", () => {
  expect(
    resolveScopeFolderFilter({
      galleryScope: "public",
      selectedFolderId: "folder-1",
      knownFolderIds: ["folder-1"],
    }),
  ).toBe("folder-1");
});

test("resolveScopeFolderFilter drops public scope folder ids outside the curated allowlist", () => {
  expect(
    resolveScopeFolderFilter({
      galleryScope: "public",
      selectedFolderId: "folder-missing",
      knownFolderIds: ["folder-1"],
    }),
  ).toBeNull();
});

test("resolveScopeFolderFilter keeps folder filter in my gallery before folders load", () => {
  expect(
    resolveScopeFolderFilter({
      galleryScope: "mine",
      selectedFolderId: "folder-1",
      knownFolderIds: null,
    }),
  ).toBe("folder-1");
});

test("resolveScopeFolderFilter drops unknown folder ids once folders are known", () => {
  expect(
    resolveScopeFolderFilter({
      galleryScope: "mine",
      selectedFolderId: "folder-missing",
      knownFolderIds: ["folder-1", "folder-2"],
    }),
  ).toBeNull();
});

test("resolveScopeFolderFilter keeps known folder ids once folders are known", () => {
  expect(
    resolveScopeFolderFilter({
      galleryScope: "mine",
      selectedFolderId: "folder-2",
      knownFolderIds: ["folder-1", "folder-2"],
    }),
  ).toBe("folder-2");
});

test("shouldShowFolderFilters only returns true for my gallery", () => {
  expect(shouldShowFolderFilters("mine")).toBeTrue();
  expect(shouldShowFolderFilters("public")).toBeFalse();
});
