// Turning "a folder of renders" into ingestable files.
//
// Three ways in — a folder picked with <input webkitdirectory>, a .zip, or a
// drag-drop of either — all normalize to the same StagedFile list, so the bulk
// panel only ever reasons about a flat, deduped, naturally-sorted array.
//
// Everything here is browser-side. Bytes still reach the vault one file at a
// time through /api/ingest (small images inline, videos and large images via
// R2), so a zip is unpacked locally rather than shipped whole.

export const MAX_BULK_FILES = 200;

// Hard stop while walking a dropped directory tree, so a stray drop of the
// Movies folder can't hang the tab before the cap is applied.
const WALK_CAP = MAX_BULK_FILES * 4;

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

export type MediaKind = "image" | "video";

/** A file plus where it sat in the folder/zip it came from. */
export type RawFile = { file: File; relativePath?: string };

export type StagedFile = {
  /** Stable across re-stages — path + size, so re-dropping the same folder
   *  doesn't duplicate rows. */
  id: string;
  file: File;
  /** Folder-relative path, shown under the thumbnail. */
  relativePath: string;
  kind: MediaKind;
};

export type StageResult = {
  added: StagedFile[];
  /** Non-media entries that were dropped on the floor. */
  skipped: number;
  /** Media files already in the batch — a re-dropped folder. */
  duplicates: number;
  /** Media files that didn't fit under MAX_BULK_FILES. */
  overflow: number;
};

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
};

/**
 * What kind of media is this, and what content type should the ingest see?
 * Files unpacked from a zip arrive as untyped blobs, so the extension is the
 * only signal — and the ingest path branches on `file.type`, which makes a
 * wrong answer here the difference between a video and a broken image.
 */
export const resolveMedia = (
  name: string,
  declaredType?: string,
): { kind: MediaKind; contentType: string } | null => {
  const extension = extensionOf(name);
  const type = declaredType?.trim().toLowerCase() ?? "";

  if (type.startsWith("image/")) {
    return { kind: "image", contentType: declaredType! };
  }
  if (type.startsWith("video/")) {
    return { kind: "video", contentType: declaredType! };
  }
  if (IMAGE_TYPES[extension]) {
    return { kind: "image", contentType: IMAGE_TYPES[extension] };
  }
  if (VIDEO_TYPES[extension]) {
    return { kind: "video", contentType: VIDEO_TYPES[extension] };
  }
  return null;
};

export const isZipFile = (file: File) =>
  file.name.toLowerCase().endsWith(".zip") ||
  file.type === "application/zip" ||
  file.type === "application/x-zip-compressed";

/** macOS resource forks and Finder droppings, which every zip from a Mac has. */
const isJunkPath = (path: string) => {
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? "";
  return (
    !name ||
    name.startsWith(".") ||
    segments.includes("__MACOSX") ||
    segments.includes("__MACOSX/")
  );
};

/** Unpack a .zip into media files, keeping the archive's inner paths. */
export const expandZip = async (archive: File): Promise<RawFile[]> => {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(archive);

  const pending: Promise<RawFile | null>[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir || isJunkPath(path)) return;
    const name = path.split("/").pop() ?? path;
    const media = resolveMedia(name);
    if (!media) return;
    pending.push(
      entry
        .async("blob")
        .then((blob) => ({
          file: new File([blob], name, { type: media.contentType }),
          relativePath: `${archive.name}/${path}`,
        }))
        .catch(() => null),
    );
  });

  const unpacked = await Promise.all(pending);
  return unpacked.filter((entry): entry is RawFile => entry !== null);
};

const readEntryFile = (entry: FileSystemFileEntry) =>
  new Promise<File | null>((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    );
  });

const readDirectoryEntries = async (directory: FileSystemDirectoryEntry) => {
  const reader = directory.createReader();
  const children: FileSystemEntry[] = [];
  // readEntries hands back at most ~100 per call and signals the end with an
  // empty batch, so it has to be drained in a loop.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(
        (results) => resolve(Array.from(results)),
        () => resolve([]),
      );
    });
    if (batch.length === 0) break;
    children.push(...batch);
    if (children.length >= WALK_CAP) break;
  }
  return children;
};

const walkEntry = async (
  entry: FileSystemEntry,
  prefix: string,
  out: RawFile[],
): Promise<void> => {
  if (out.length >= WALK_CAP) return;
  if (entry.isFile) {
    const file = await readEntryFile(entry as FileSystemFileEntry);
    if (file) out.push({ file, relativePath: `${prefix}${file.name}` });
    return;
  }
  if (!entry.isDirectory) return;
  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
  for (const child of children) {
    await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
};

/**
 * Read a drop. Folders only come through the entries API — `dataTransfer.files`
 * reports a dropped directory as a single zero-byte "file" — so entries win
 * whenever the browser offers them. They must be captured synchronously,
 * before the first await, or the DataTransfer is already drained.
 */
export const readDroppedFiles = async (
  dataTransfer: DataTransfer,
): Promise<RawFile[]> => {
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) =>
      typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null,
    );

  if (!entries.some(Boolean)) {
    return Array.from(dataTransfer.files ?? []).map((file) => ({ file }));
  }

  const out: RawFile[] = [];
  for (const entry of entries) {
    if (entry) await walkEntry(entry, "", out);
  }
  return out;
};

export const filesToRaw = (files: FileList | File[]): RawFile[] =>
  Array.from(files).map((file) => ({
    file,
    // Set by <input webkitdirectory>; empty for a plain multi-file pick.
    relativePath: file.webkitRelativePath || undefined,
  }));

/**
 * Expand any zips, drop non-media, drop anything already staged, sort the way
 * a render folder reads (shot_2 before shot_10), and cap the batch.
 */
export const stageBulkFiles = async (
  inputs: RawFile[],
  existing: StagedFile[] = [],
): Promise<StageResult> => {
  const expanded: RawFile[] = [];
  for (const input of inputs) {
    if (isZipFile(input.file)) {
      expanded.push(...(await expandZip(input.file)));
    } else {
      expanded.push(input);
    }
  }

  const seen = new Set(existing.map((item) => item.id));
  const candidates: StagedFile[] = [];
  let skipped = 0;
  let duplicates = 0;

  for (const { file, relativePath } of expanded) {
    const path = relativePath || file.name;
    if (isJunkPath(path)) {
      skipped += 1;
      continue;
    }
    const media = resolveMedia(file.name, file.type);
    if (!media) {
      skipped += 1;
      continue;
    }
    const id = `${path}:${file.size}`;
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    candidates.push({
      id,
      // Re-wrap only when the browser gave us no type to work with, so the
      // ingest branch on file.type stays correct for zip-sourced files.
      file: file.type ? file : new File([file], file.name, { type: media.contentType }),
      relativePath: path,
      kind: media.kind,
    });
  }

  candidates.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  const room = Math.max(0, MAX_BULK_FILES - existing.length);
  return {
    added: candidates.slice(0, room),
    skipped,
    duplicates,
    overflow: Math.max(0, candidates.length - room),
  };
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
};
