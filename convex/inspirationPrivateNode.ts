"use node";

import { v, type Infer } from "convex/values";
import { signedOwnerAction as ownerAction } from "./actor";
import { attachChecked, privateMediaViewValidator, recordArgs, type CutCopies } from "./inspirationPrivate";
import { INSPIRATION_PRIVATE as P } from "../lib/inspiration";

// The only way to attach a private original: sniff its first bytes against
// the declared type, record it, then cut the clean copies. sharp re-encodes
// to WebP and, with no keepMetadata/withMetadata call, writes no EXIF, GPS,
// XMP, maker notes or ICC; autoOrient bakes the rotation in first so the
// picture still stands the right way up without its EXIF.

type Sharp = (typeof import("sharp"))["default"];
let sharpLoader: Promise<Sharp> | undefined;
const loadSharp = () => {
  sharpLoader ??= import("sharp").then((mod) => {
    mod.default.cache(false);
    return mod.default;
  });
  return sharpLoader;
};

export const cutWithSharp: CutCopies = async (bytes) => {
  const sharp = await loadSharp();
  const input = Buffer.from(bytes);
  try {
    await sharp(input, { failOn: "none" }).metadata();
  } catch {
    return { note: "This format cannot be re-encoded here (often iPhone HEIC); only the original is kept." };
  }
  const encode = async (edge: number, quality: number) => {
    const { data, info } = await sharp(input, { failOn: "none" })
      .autoOrient()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), width: info.width, height: info.height };
  };
  try {
    return { display: await encode(P.displayEdge, 84), thumb: await encode(P.thumbEdge, 74) };
  } catch {
    return { note: "This format cannot be re-encoded here (often iPhone HEIC); only the original is kept." };
  }
};

export const attachPrivateMedia = ownerAction({
  args: recordArgs,
  returns: v.object({ media: privateMediaViewValidator, created: v.boolean() }),
  handler: async (ctx, args): Promise<{ media: Infer<typeof privateMediaViewValidator>; created: boolean }> => {
    // The signed signature field is set by the check, never by the caller.
    const { signature: _ignored, ...rest } = args;
    void _ignored;
    return attachChecked(ctx, rest, cutWithSharp);
  },
});
