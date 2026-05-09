import type { ActionCtx } from "./_generated/server";
import { r2 } from "./r2";

type StoreOptions = {
  key?: string;
  type?: string;
};

const hasR2Config = () =>
  Boolean(
    process.env.R2_BUCKET &&
      process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );

const extensionForType = (type?: string) => {
  if (!type) return "bin";
  if (type.includes("jpeg")) return "jpg";
  const subtype = type.split("/")[1]?.split(";")[0]?.trim();
  return subtype && /^[a-z0-9.+-]{1,16}$/i.test(subtype) ? subtype : "bin";
};

export const storeBlobToR2 = async (
  ctx: ActionCtx,
  blob: Blob,
  options: StoreOptions = {},
) => {
  if (process.env.NODE_ENV === "test" && !hasR2Config()) {
    return (
      options.key ??
      `test-r2/${Date.now()}-${crypto.randomUUID()}.${extensionForType(options.type || blob.type)}`
    );
  }

  return await r2.store(ctx, blob, options);
};
