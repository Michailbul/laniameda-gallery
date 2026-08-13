// Local file/folder upload helpers shared by the extension side panel and tests.
(function initDropUpload(globalThis) {
  "use strict";

  const MAX_QUEUE_FILES = 250;
  const MAX_HASH_BYTES = 256 * 1024 * 1024;
  const THUMB_MAX_EDGE = 1024;
  const VIDEO_POSTER_MAX_EDGE = 1280;
  const IMAGE_EXTENSIONS = new Set([
    "avif",
    "gif",
    "heic",
    "heif",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "webp",
  ]);
  const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "webm"]);
  const CONTENT_TYPES = {
    avif: "image/avif",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    mp4: "video/mp4",
    png: "image/png",
    svg: "image/svg+xml",
    webm: "video/webm",
    webp: "image/webp",
  };

  function extensionOf(name) {
    const match = /\.([^.]+)$/.exec(String(name || "").toLowerCase());
    return match ? match[1] : "";
  }

  function inferContentType(file) {
    const declared = String(file?.type || "").trim().toLowerCase();
    if (declared.startsWith("image/") || declared.startsWith("video/")) {
      return declared;
    }
    return CONTENT_TYPES[extensionOf(file?.name)] || "";
  }

  function isSupportedMediaFile(file) {
    if (!file || typeof file.name !== "string") return false;
    if (file.name === ".DS_Store" || file.name.startsWith("._")) return false;
    const contentType = inferContentType(file);
    if (contentType.startsWith("image/") || contentType.startsWith("video/")) {
      return true;
    }
    const extension = extensionOf(file.name);
    return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
  }

  function normalizeRelativePath(value, fallbackName) {
    const normalized = String(value || fallbackName || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/{2,}/g, "/")
      .trim();
    return normalized || String(fallbackName || "Untitled asset");
  }

  function queueIdentity(item) {
    const file = item.file;
    return [
      normalizeRelativePath(item.relativePath, file?.name).toLowerCase(),
      Number(file?.size || 0),
      Number(file?.lastModified || 0),
    ].join(":");
  }

  function normalizePickedFiles(files, limit = MAX_QUEUE_FILES) {
    const accepted = [];
    let rejectedCount = 0;
    let truncatedCount = 0;
    const seen = new Set();

    for (const file of Array.from(files || [])) {
      if (!isSupportedMediaFile(file)) {
        rejectedCount += 1;
        continue;
      }
      const item = {
        file,
        relativePath: normalizeRelativePath(file.webkitRelativePath, file.name),
      };
      const identity = queueIdentity(item);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (accepted.length >= limit) {
        truncatedCount += 1;
        continue;
      }
      accepted.push(item);
    }

    return { accepted, rejectedCount, truncatedCount };
  }

  function readFileEntry(entry, relativePath) {
    return new Promise((resolve, reject) => {
      entry.file(
        (file) => resolve({
          file,
          relativePath: normalizeRelativePath(relativePath, file.name),
        }),
        reject,
      );
    });
  }

  async function readDirectoryEntries(directoryEntry) {
    const reader = directoryEntry.createReader();
    const entries = [];
    // Chrome returns directory contents in chunks (usually 100 entries). An
    // empty batch, not the first callback, marks the end of the directory.
    while (true) {
      const batch = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!batch.length) break;
      entries.push(...batch);
    }
    return entries;
  }

  async function walkEntry(entry, parentPath = "") {
    const path = normalizeRelativePath(
      parentPath ? `${parentPath}/${entry.name}` : entry.name,
      entry.name,
    );
    if (entry.isFile) {
      return [await readFileEntry(entry, path)];
    }
    if (!entry.isDirectory) return [];

    const children = await readDirectoryEntries(entry);
    const nested = await Promise.all(children.map((child) => walkEntry(child, path)));
    return nested.flat();
  }

  async function collectDroppedFiles(dataTransfer, limit = MAX_QUEUE_FILES) {
    const transferItems = Array.from(dataTransfer?.items || []);
    const entries = transferItems
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);

    let rawItems;
    if (entries.length > 0) {
      rawItems = (await Promise.all(entries.map((entry) => walkEntry(entry)))).flat();
    } else {
      rawItems = Array.from(dataTransfer?.files || []).map((file) => ({
        file,
        relativePath: normalizeRelativePath(file.webkitRelativePath, file.name),
      }));
    }

    const accepted = [];
    let rejectedCount = 0;
    let truncatedCount = 0;
    const seen = new Set();
    for (const item of rawItems) {
      if (!isSupportedMediaFile(item.file)) {
        rejectedCount += 1;
        continue;
      }
      const identity = queueIdentity(item);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (accepted.length >= limit) {
        truncatedCount += 1;
        continue;
      }
      accepted.push(item);
    }
    return { accepted, rejectedCount, truncatedCount };
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB"];
    let size = value / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && size >= 1024; index += 1) {
      size /= 1024;
      unit = units[index];
    }
    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
  }

  async function hashFile(file) {
    if (!globalThis.crypto?.subtle || file.size > MAX_HASH_BYTES) return undefined;
    try {
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return undefined;
    }
  }

  function fitWithin(width, height, maxEdge) {
    if (width <= maxEdge && height <= maxEdge) return { width, height };
    const scale = maxEdge / Math.max(width, height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  function canvasToBlob(canvas, contentType = "image/jpeg", quality = 0.82) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Preview encoding failed."))),
        contentType,
        quality,
      );
    });
  }

  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function prepareImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const target = fitWithin(bitmap.width, bitmap.height, THUMB_MAX_EDGE);
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable.");
      context.fillStyle = "#faf6f1";
      context.fillRect(0, 0, target.width, target.height);
      context.drawImage(bitmap, 0, 0, target.width, target.height);
      const posterBlob = await canvasToBlob(canvas);
      return {
        width: bitmap.width,
        height: bitmap.height,
        posterFile: {
          base64: await blobToBase64(posterBlob),
          contentType: "image/jpeg",
          width: target.width,
          height: target.height,
          size: posterBlob.size,
        },
      };
    } finally {
      bitmap.close?.();
    }
  }

  async function prepareVideo(file) {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    try {
      const dimensions = await new Promise((resolve, reject) => {
        const timeoutId = globalThis.setTimeout(
          () => reject(new Error("Video preview timed out.")),
          12000,
        );
        const fail = () => {
          globalThis.clearTimeout(timeoutId);
          reject(new Error("The browser could not decode this video."));
        };
        video.addEventListener("error", fail, { once: true });
        video.addEventListener("loadedmetadata", () => {
          try {
            video.currentTime = Math.min(0.1, Math.max(0, video.duration - 0.05));
          } catch {
            fail();
          }
        }, { once: true });
        video.addEventListener("seeked", () => {
          globalThis.clearTimeout(timeoutId);
          resolve({ width: video.videoWidth, height: video.videoHeight });
        }, { once: true });
        video.src = objectUrl;
      });

      if (!dimensions.width || !dimensions.height) {
        throw new Error("Video has no decodable frame.");
      }
      const target = fitWithin(
        dimensions.width,
        dimensions.height,
        VIDEO_POSTER_MAX_EDGE,
      );
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context unavailable.");
      context.drawImage(video, 0, 0, target.width, target.height);
      const posterBlob = await canvasToBlob(canvas, "image/jpeg", 0.72);
      return {
        width: dimensions.width,
        height: dimensions.height,
        posterFile: {
          base64: await blobToBase64(posterBlob),
          contentType: "image/jpeg",
          width: target.width,
          height: target.height,
          size: posterBlob.size,
        },
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load?.();
    }
  }

  async function prepareMedia(file) {
    const contentType = inferContentType(file);
    const isVideo = contentType.startsWith("video/");
    const [contentHash, preview] = await Promise.all([
      hashFile(file),
      (isVideo ? prepareVideo(file) : prepareImage(file)).catch((error) => {
        if (isVideo) throw error;
        return {};
      }),
    ]);

    return {
      contentHash,
      contentType,
      mediaType: isVideo ? "video" : "image",
      size: file.size,
      width: preview.width,
      height: preview.height,
      posterFile: preview.posterFile,
    };
  }

  globalThis.SaveToGalleryDropUpload = {
    MAX_QUEUE_FILES,
    collectDroppedFiles,
    formatBytes,
    inferContentType,
    isSupportedMediaFile,
    normalizePickedFiles,
    normalizeRelativePath,
    prepareMedia,
    queueIdentity,
  };
})(globalThis);
