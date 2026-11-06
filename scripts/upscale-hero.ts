// Give hero stills their 4K rendition with a local Topaz key.
//
//   bun scripts/upscale-hero.ts --env-file <protected convex env> <assetId> [<assetId> …]
//   bun scripts/upscale-hero.ts --env-file <protected convex env> --world dear-annete
//   add --force to redo a frame that already has one
//
// The deployment upscales by itself when TOPAZ_API_KEY is set there
// (convex/heroRendition.ts). Until then an agent runs this: Topaz runs here
// with TOPAZ_API_KEY, TOPAZ_API_KEY_2, … from the shell (a key out of credit
// is skipped), the 5120 and 2560 JPEGs go to R2 through signed upload URLs,
// and the asset's heroRendition is recorded with `convex run` (deploy access
// from the env file). No key ever leaves this machine.
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { buildSanitizedConvexEnv } from "./lib/convex-dev-env";
import {
  HERO_RENDITION_STEP_WIDTH,
  TOPAZ_HERO_MODEL,
  TopazKeyError,
  topazEnhance,
} from "../lib/topaz";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value;
};
const envFile = flag("--env-file");
const world = flag("--world");
const force = argv.includes("--force");
const ids = argv.filter((arg) => !arg.startsWith("--"));
if (!envFile || (!world && !ids.length)) {
  console.error("usage: bun scripts/upscale-hero.ts --env-file <convex env> (--world <slug> | <assetId>…) [--force]");
  process.exit(1);
}

const convexRun = <T>(fn: string, args: Record<string, unknown>): T => {
  const result = spawnSync(
    "bunx",
    ["convex", "run", "--env-file", envFile, fn, JSON.stringify(args)],
    { env: buildSanitizedConvexEnv(process.env), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`convex run ${fn} failed: ${result.stderr || result.stdout}`);
  const out = result.stdout.trim();
  return (out ? JSON.parse(out) : null) as T;
};

const keys = Object.keys(process.env)
  .filter((name) => /^TOPAZ_API_KEY(_\d+)?$/.test(name) && process.env[name]?.trim())
  .sort();
if (!keys.length) {
  console.error("No TOPAZ_API_KEY* in the environment (source ~/.config/laniameda/keys.env).");
  process.exit(1);
}

const enhance = async (image: Blob, fileName: string) => {
  for (const name of keys) {
    try {
      const out = await topazEnhance({ apiKey: process.env[name]!.trim(), image, fileName });
      return { out, key: name };
    } catch (error) {
      if (error instanceof TopazKeyError) {
        console.warn(`  ${name}: ${error.message.slice(0, 160)}; trying the next key`);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Every Topaz key was refused (out of credit?).");
};

type Source = { url: string; fileName: string; width: number; height: number } | null;

const upscaleOne = async (assetId: string) => {
  const source = convexRun<Source>("heroRenditionData:heroSource", { assetId, force });
  if (!source) {
    console.log(`${assetId}: nothing to do (not a still, already 4K or done; --force to redo)`);
    return;
  }
  const original = await fetch(source.url);
  if (!original.ok) throw new Error(`${assetId}: original answered ${original.status}`);
  const started = Date.now();
  const { out, key } = await enhance(await original.blob(), source.fileName);
  const big = Buffer.from(await out.arrayBuffer());
  const bigMeta = await sharp(big).metadata();
  const step = await sharp(big)
    .resize({ width: HERO_RENDITION_STEP_WIDTH })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const uploads = convexRun<Array<{ key: string; url: string }>>("heroRenditionData:prepareUploads", { count: 2 });
  const files = [
    { bytes: step.data, width: step.info.width, height: step.info.height },
    { bytes: big, width: bigMeta.width ?? 0, height: bigMeta.height ?? 0 },
  ];
  for (const [i, file] of files.entries()) {
    const put = await fetch(uploads[i].url, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(file.bytes),
    });
    if (!put.ok) throw new Error(`${assetId}: R2 upload answered ${put.status}`);
  }
  convexRun("heroRenditionData:recordHeroRendition", {
    assetId,
    model: `topaz ${TOPAZ_HERO_MODEL}`,
    variants: files.map((file, i) => ({ r2Key: uploads[i].key, width: file.width, height: file.height })),
  });
  console.log(
    `${assetId}: ${source.width}px → ${files[1].width}px + ${files[0].width}px ` +
      `(${(big.byteLength / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s, ${key})`,
  );
};

const targets = world ? convexRun<string[]>("heroRenditionData:heroStillsOfWorld", { slug: world }) : ids;
console.log(`${targets.length} hero still(s) to upscale`);
let failed = 0;
for (const assetId of targets) {
  try {
    await upscaleOne(assetId);
  } catch (error) {
    failed += 1;
    console.error(error instanceof Error ? error.message : error);
  }
}
process.exit(failed ? 1 : 0);
