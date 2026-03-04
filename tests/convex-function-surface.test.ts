import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

const read = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

test("destructive prompt mutations stay internal-only", () => {
  const source = read("convex/prompts.ts");

  expect(source).toContain("export const deletePrompt = internalMutation({");
  expect(source).toContain("export const bulkDeletePrompts = internalMutation({");

  expect(source).not.toContain("export const deletePrompt = mutation({");
  expect(source).not.toContain("export const bulkDeletePrompts = mutation({");
});

test("destructive asset mutations stay internal-only", () => {
  const source = read("convex/assets.ts");

  expect(source).toContain("export const bulkDeleteAssets = internalMutation({");
  expect(source).toContain("export const wipeAllAssets = internalMutation({");

  expect(source).not.toContain("export const bulkDeleteAssets = mutation({");
  expect(source).not.toContain("export const wipeAllAssets = mutation({");
});
