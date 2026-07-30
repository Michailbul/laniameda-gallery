/**
 * SHA-256 of a file's bytes, hex — the vault's content identity for media.
 *
 * Media that goes browser → R2 never passes through the ingest action, so the
 * digest has to be computed here or the asset lands without one and skips the
 * duplicate check. Uses Web Crypto, which needs a secure context: on http
 * origins other than localhost `crypto.subtle` is undefined, so this returns
 * undefined rather than throwing, and ingest simply falls back to the old
 * ingestKey-only behaviour.
 *
 * Web Crypto has no streaming digest, so the whole file has to sit in memory as
 * one ArrayBuffer. Past the ceiling below that allocation is a bad trade inside
 * a browser tab, so the hash is skipped: the asset saves normally, and
 * contentHash:backfillContentHashes — which streams from R2 at flat memory —
 * fills the digest in afterwards.
 */
const MAX_BROWSER_HASH_BYTES = 256 * 1024 * 1024;

export async function hashFileContent(file: Blob): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  if (file.size > MAX_BROWSER_HASH_BYTES) return undefined;
  try {
    const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // A hash we can't compute must never block a save.
    return undefined;
  }
}
