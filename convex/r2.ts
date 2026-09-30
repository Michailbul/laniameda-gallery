import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { requireActor } from "./actor";

// Component instance. Reads R2_BUCKET / R2_ENDPOINT / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY from Convex env. R2_PUBLIC_BASE_URL is read directly
// from process.env in convex/r2_url.ts since the component itself only
// signs and serves URLs through the S3 client.
export const r2 = new R2(components.r2);

// Public client API used by the browser via @convex-dev/r2/react's
// useUploadFile hook and by the skill's ingest script. Only a signed-in
// actor may reserve upload URLs; /api/ingest still decides whether an
// upload becomes a gallery asset row. Orphaned R2 objects (uploaded but
// never ingested) get cleaned up by a future janitor.
export const {
  generateUploadUrl,
  syncMetadata,
  getMetadata,
} = r2.clientApi<DataModel>({
  checkUpload: async (ctx) => {
    await requireActor(ctx);
  },
});
