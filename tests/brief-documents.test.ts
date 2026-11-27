import { describe, expect, test } from "bun:test";
import { briefKindValidator } from "../convex/projectValidators";
import {
  BRIEF_KINDS, BRIEF_KIND_LABELS, briefDownloadUrl, briefFileLabel, defaultReaderFile, briefReaderMode, inferBriefContentType, isDocumentKind, needsSandbox,
} from "../lib/brief-documents";
import { projectSaveBriefSchema } from "../lib/project-contract";

// Scripts, scene breakdowns and documents read inside the project room:
// one kind list for the backend, the agent contract and the page, and the
// content type every brief file is stored and served with.

describe("brief kinds", () => {
  test("the Convex validator, the agent contract and the labels list the same kinds", () => {
    const literals = briefKindValidator.members.map((member) => member.value);
    expect([...literals].sort()).toEqual([...BRIEF_KINDS].sort());
    expect(Object.keys(BRIEF_KIND_LABELS).sort()).toEqual([...BRIEF_KINDS].sort());
    for (const kind of ["breakdown", "document", "script", "brief"]) {
      expect(projectSaveBriefSchema.parse({ world: "cassandra", ingestKey: `t:${kind}`, kind }).kind).toBe(kind);
    }
    expect(() => projectSaveBriefSchema.parse({ world: "cassandra", ingestKey: "t:x", kind: "treatment" })).toThrow();
  });

  test("scripts, breakdowns and documents are the readable section; the rest stay From production", () => {
    expect(["script", "breakdown", "document"].every(isDocumentKind)).toBe(true);
    expect(["brief", "storyboard", "style_guide", "references", "other"].some(isDocumentKind)).toBe(false);
    expect(BRIEF_KIND_LABELS.breakdown).toBe("Scene breakdown");
    expect(BRIEF_KIND_LABELS.document).toBe("Document");
  });
});

describe("brief file content types", () => {
  test("a missing or generic type is read from the name", () => {
    expect(inferBriefContentType("script.html")).toBe("text/html; charset=utf-8");
    expect(inferBriefContentType("Breakdown.HTM", "application/octet-stream")).toBe("text/html; charset=utf-8");
    expect(inferBriefContentType("notes.md", "")).toBe("text/markdown; charset=utf-8");
    expect(inferBriefContentType("notes.txt", null)).toBe("text/plain; charset=utf-8");
    expect(inferBriefContentType("CASSANDRA.pdf", "binary/octet-stream")).toBe("application/pdf");
    expect(inferBriefContentType("Treatment.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(inferBriefContentType("mystery")).toBe("application/octet-stream");
  });

  test("a real type wins; text gets utf-8; a .md sent as text/plain is Markdown", () => {
    expect(inferBriefContentType("x.bin", "application/pdf")).toBe("application/pdf");
    expect(inferBriefContentType("page", "text/html")).toBe("text/html; charset=utf-8");
    expect(inferBriefContentType("page.html", "text/html; charset=windows-1250")).toBe("text/html; charset=windows-1250");
    expect(inferBriefContentType("breakdown.md", "text/plain")).toBe("text/markdown; charset=utf-8");
  });

  test("the reader picks a view per file", () => {
    expect(briefReaderMode("text/html; charset=utf-8", "a.html")).toBe("html");
    expect(briefReaderMode("application/octet-stream", "a.md")).toBe("markdown");
    expect(briefReaderMode("text/markdown", "a")).toBe("markdown");
    expect(briefReaderMode("application/pdf", "a.pdf")).toBe("pdf");
    expect(briefReaderMode("text/plain", "a.txt")).toBe("text");
    expect(briefReaderMode("image/png", "a.png")).toBe("image");
    expect(briefReaderMode("image/svg+xml", "a.svg")).toBe("html");
    expect(briefReaderMode("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBe("download");
    expect(briefFileLabel("application/octet-stream", "a.md")).toBe("MARKDOWN");
    expect(briefFileLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBe("DOCX");
  });

  test("HTML and SVG are served sandboxed; PDFs and text are not", () => {
    expect(needsSandbox("text/html; charset=utf-8")).toBe(true);
    expect(needsSandbox("image/svg+xml")).toBe(true);
    expect(needsSandbox("application/pdf")).toBe(false);
    expect(needsSandbox("text/markdown; charset=utf-8")).toBe(false);
    expect(briefDownloadUrl("/api/briefs/b/files/f1")).toBe("/api/briefs/b/files/f1?download=1");
    expect(briefDownloadUrl("/api/briefs/b/files/f1?cover=1")).toBe("/api/briefs/b/files/f1?cover=1&download=1");
  });
});

describe("reader default file", () => {
  test("opens the newest readable file, else the first", () => {
    const pdf = { key: "f1", name: "a.pdf", contentType: "application/pdf" };
    const v2 = { key: "f2", name: "b-v2.html", contentType: "text/html" };
    const docx = { key: "f3", name: "c.docx", contentType: "application/octet-stream" };
    expect(defaultReaderFile([pdf, v2, docx])?.key).toBe("f2");
    expect(defaultReaderFile([docx])?.key).toBe("f3");
    expect(defaultReaderFile([])).toBeUndefined();
  });
});
