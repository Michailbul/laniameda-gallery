import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import sharp from "sharp";

const LOCAL_DIR = path.join(process.cwd(), "public", "images-test");
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const THUMB_MAX_WIDTH = 520;

const guessContentType = (ext: string) => {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
};

const getConvexUrl = () =>
  process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;

const listFiles = async (dir: string) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await listFiles(path.join(dir, entry.name));
      files.push(...nested);
      continue;
    }

    if (entry.isFile()) {
      const fullPath = path.join(dir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
};

const main = async () => {
  const convexUrl = getConvexUrl();
  if (!convexUrl) {
    console.warn("Skipping local asset ingest: CONVEX_URL is not configured.");
    return;
  }

  try {
    const dirStat = await stat(LOCAL_DIR);
    if (!dirStat.isDirectory()) {
      console.warn(`Skipping local asset ingest: ${LOCAL_DIR} is not a directory.`);
      return;
    }
  } catch {
    console.warn(`Skipping local asset ingest: ${LOCAL_DIR} not found.`);
    return;
  }

  const files = await listFiles(LOCAL_DIR);
  if (files.length === 0) {
    console.warn("Skipping local asset ingest: no supported images found.");
    return;
  }

  const client = new ConvexHttpClient(convexUrl);
  const existingCount = await client.query(api.assets.countAssets, {});
  if (existingCount > 0) {
    console.log("Local ingest skipped: assets already present in Convex.");
    return;
  }

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = guessContentType(ext);
    const fileName = path.basename(filePath);
    const relativePath = path.relative(LOCAL_DIR, filePath);
    const promptText = path.parse(fileName).name.replace(/[-_]+/g, " ").trim();
    const ingestKey = `local:${relativePath}`;

    const exists = await client.query(api.assets.hasAssetForIngestKey, {
      ingestKey,
    });
    if (exists) {
      continue;
    }

    const buffer = await readFile(filePath);
    const image = sharp(buffer, { animated: true });
    const metadata = await image.metadata();
    const originalUploadUrl = await client.mutation(api.files.generateUploadUrl, {});
    const originalResponse = await fetch(originalUploadUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: buffer,
    });

    if (!originalResponse.ok) {
      throw new Error(await originalResponse.text());
    }

    const { storageId } = (await originalResponse.json()) as { storageId: string };
    const thumbBuffer = await image
      .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
      .toBuffer();
    const thumbUploadUrl = await client.mutation(api.files.generateUploadUrl, {});
    const thumbResponse = await fetch(thumbUploadUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: thumbBuffer,
    });

    if (!thumbResponse.ok) {
      throw new Error(await thumbResponse.text());
    }

    const { storageId: thumbStorageId } = (await thumbResponse.json()) as {
      storageId: string;
    };
    const thumbMeta = await sharp(thumbBuffer, { animated: true }).metadata();
    const promptResult = promptText
      ? await client.mutation(api.prompts.createPrompt, {
          text: promptText,
          tagIds: [],
          ingestKey: `${ingestKey}:prompt`,
        })
      : undefined;

    await client.mutation(api.assets.createAsset, {
      kind: "image",
      storageId,
      thumbStorageId,
      sourceUrl: undefined,
      fileName,
      contentType,
      size: buffer.byteLength,
      width: metadata.width ?? undefined,
      height: metadata.height ?? undefined,
      thumbSize: thumbBuffer.byteLength,
      thumbWidth: thumbMeta.width ?? undefined,
      thumbHeight: thumbMeta.height ?? undefined,
      promptId: promptResult?.promptId,
      tagIds: [],
      folderId: undefined,
      ingestKey,
    });
  }

  console.log(`Local ingest complete: ${files.length} file(s).`);
};

main().catch((error) => {
  console.error("Local ingest failed:", error);
  process.exitCode = 1;
});
