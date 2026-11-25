import { describe, expect, test } from "bun:test";
import { queueProjects } from "@/lib/mj-queue";

const t = (batch: string, worldKey = "dear-annete-art-deco") => ({ batch, batchKey: batch.toLowerCase(), worldKey });
const names: Record<string, string> = { "dear-annete-art-deco": "DEAR ANNETE — ART DECO", "dear-annete": "DEAR ANNETE" };

describe("queue projects", () => {
  test("a label prefix shared by two threads of a world is a project; the world's own name is not", () => {
    const threads = [t("HEEL · the kitchen · 20 Nov"), t("HEEL · the drive"), t("Dear Annete · towers"), t("Dear Annete · houses"), t("Test · one off"), t("Plain label")];
    const projects = queueProjects(threads, (key) => names[key ?? ""] ?? "");
    expect(projects.get("heel · the kitchen · 20 nov")).toBe("HEEL");
    expect(projects.get("heel · the drive")).toBe("HEEL");
    expect(projects.has("dear annete · towers")).toBe(false);
    expect(projects.has("test · one off")).toBe(false);
    expect(projects.has("plain label")).toBe(false);
  });
  test("the same prefix in two worlds needs two threads in each", () => {
    const projects = queueProjects([t("HEEL · a"), t("HEEL · b", "dear-annete")], (key) => names[key ?? ""] ?? "");
    expect(projects.size).toBe(0);
  });
});
