// Production brief kinds and the files that can be read inside the project
// room (/w/<world>/project). Shared by the Convex backend (attachBriefFile),
// the owner-only file route (/api/briefs/<briefId>/files/<key>), the agent
// contract and the reader on the project page.
//
// Michael, 27 Nov 2026: "not only images but also md files, or better HTML,
// so that we can save the scripts there ... so that we can see the script."

export const BRIEF_KINDS = [
  "brief", "storyboard", "script", "style_guide", "references", "other",
  // Written by the art department: scene breakdowns, treatments, notes.
  "breakdown", "document",
] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];

export const BRIEF_KIND_LABELS: Record<BriefKind, string> = {
  brief: "Design brief",
  storyboard: "Storyboard",
  script: "Script",
  style_guide: "Style guide",
  references: "Photo set",
  other: "From production",
  breakdown: "Scene breakdown",
  document: "Document",
};

/** Kinds the project room shows under "Scripts & documents"; the rest are "From production". */
export const DOCUMENT_KINDS: ReadonlySet<BriefKind> = new Set<BriefKind>(["script", "breakdown", "document"]);
export const isDocumentKind = (kind: string) => DOCUMENT_KINDS.has(kind as BriefKind);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const BY_EXTENSION: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  fountain: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  docx: DOCX,
  doc: "application/msword",
  rtf: "application/rtf",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const GENERIC = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-www-form-urlencoded", "multipart/form-data"]);

const extensionOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
const baseType = (contentType: string | undefined) => contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

/**
 * The content type a brief file is stored and served with. A real type wins;
 * a missing or generic one (octet-stream, form posts) is read from the name:
 * .html/.htm → text/html, .md → text/markdown, .txt → text/plain (all utf-8),
 * .pdf, .docx and the usual pictures.
 */
export const inferBriefContentType = (name: string, contentType?: string | null): string => {
  const given = contentType?.trim() ?? "";
  const base = baseType(given);
  const byName = BY_EXTENSION[extensionOf(name)];
  if (!GENERIC.has(base)) {
    // A .md sent as text/plain is still Markdown.
    if (base === "text/plain" && byName?.startsWith("text/markdown")) return byName;
    // Text without a charset reads as utf-8 (agent-written scripts are).
    if ((base === "text/html" || base === "text/markdown" || base === "text/plain") && !/charset=/i.test(given)) return `${base}; charset=utf-8`;
    return given;
  }
  return byName ?? "application/octet-stream";
};

export type BriefReaderMode = "html" | "markdown" | "pdf" | "text" | "image" | "download";

/** How the project room's reader shows a file. */
export const briefReaderMode = (contentType: string, name: string): BriefReaderMode => {
  const base = baseType(inferBriefContentType(name, contentType));
  if (base === "text/html" || base === "application/xhtml+xml") return "html";
  if (base === "text/markdown" || base === "text/x-markdown") return "markdown";
  if (base === "application/pdf") return "pdf";
  if (base === "text/plain" || base === "text/csv") return "text";
  if (base === "image/svg+xml") return "html"; // an SVG may carry script: sandboxed like HTML
  if (base.startsWith("image/")) return "image";
  return "download";
};

/** Responses that must be sandboxed (no gallery origin, no session) even when opened directly. */
export const needsSandbox = (contentType: string) => {
  const base = baseType(contentType);
  return base === "text/html" || base === "application/xhtml+xml" || base === "image/svg+xml" || base === "text/xml" || base === "application/xml";
};

/** Same flags for the CSP header and the reader's iframe: scripts run, popups open, never the gallery's origin. */
export const SANDBOX_FLAGS = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/** A short mono label for a file: HTML, MARKDOWN, PDF, TEXT, DOCX, PNG … */
export const briefFileLabel = (contentType: string, name: string) => {
  const mode = briefReaderMode(contentType, name);
  if (mode === "html") return baseType(contentType) === "image/svg+xml" ? "SVG" : "HTML";
  if (mode === "markdown") return "MARKDOWN";
  if (mode === "pdf") return "PDF";
  if (mode === "text") return "TEXT";
  const ext = extensionOf(name);
  return ext ? ext.toUpperCase() : "FILE";
};

/** The file route's address with ?download=1 (attachment instead of inline). */
export const briefDownloadUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download=1`;

/** The file the reader opens first: the newest one it can show (files are kept in the order added), else the first. */
export const defaultReaderFile = <T extends { contentType: string; name: string }>(files: readonly T[]): T | undefined =>
  [...files].reverse().find((file) => briefReaderMode(file.contentType, file.name) !== "download") ?? files[0];
