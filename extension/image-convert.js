// Shared by the content script and the service worker: re-encode captured
// image bytes to JPEG before they are uploaded.
//
// Midjourney (and most modern CDNs) serve WebP. Storing those bytes verbatim
// left the gallery holding .webp files — a format the ingest decoder can't
// read (no dimensions, so the masonry falls back to a 1:1 square) and that
// lands as a .webp on disk when the piece is downloaded later. The browser
// already has a WebP decoder, so the conversion happens here, at capture time.
//
// PNG is left alone on purpose: JPEG has no alpha, and a transparent asset
// would come back flattened. GIF keeps its animation for the same reason.
(function () {
  "use strict";

  const JPEG_QUALITY = 0.94;

  // Formats re-encoded on capture. Everything else is stored as-is.
  const CONVERTIBLE_TYPES = new Set([
    "image/webp",
    "image/avif",
    "image/heic",
    "image/heif",
  ]);

  const normalizeType = (contentType) =>
    String(contentType || "").split(";")[0].trim().toLowerCase();

  function shouldConvertToJpeg(contentType) {
    return CONVERTIBLE_TYPES.has(normalizeType(contentType));
  }

  function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(width, height);
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    return null;
  }

  function canvasToJpegBlob(canvas) {
    if (typeof canvas.convertToBlob === "function") {
      return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed."))),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  }

  async function blobToJpegBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = createCanvas(bitmap.width, bitmap.height);
      if (!canvas) throw new Error("No canvas available for conversion.");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable.");
      // JPEG has no alpha channel — flatten onto white rather than black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      return await canvasToJpegBlob(canvas);
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  }

  /**
   * Convert a captured blob to JPEG when its format warrants it. Returns the
   * original blob untouched when no conversion is needed — and also when the
   * conversion fails, so a decode error degrades to the old behaviour instead
   * of losing the save.
   */
  async function convertCapturedBlob(blob, contentType) {
    const sourceType = normalizeType(contentType || blob.type);
    if (!shouldConvertToJpeg(sourceType)) {
      return { blob, contentType: sourceType || "application/octet-stream", converted: false };
    }
    try {
      const jpeg = await blobToJpegBlob(blob);
      return { blob: jpeg, contentType: "image/jpeg", converted: true };
    } catch (err) {
      console.warn("[Save to Gallery] JPEG conversion failed:", err);
      return { blob, contentType: sourceType, converted: false };
    }
  }

  // Chunked so a multi-megabyte image doesn't blow the argument limit of
  // String.fromCharCode.apply.
  async function base64FromBlob(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  globalThis.SaveToGalleryImageConvert = {
    shouldConvertToJpeg,
    blobToJpegBlob,
    convertCapturedBlob,
    base64FromBlob,
  };
})();
