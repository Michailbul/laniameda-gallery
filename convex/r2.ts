import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

// Component instance. Reads R2_BUCKET / R2_ENDPOINT / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY from Convex env. R2_PUBLIC_BASE_URL is read directly
// from process.env in convex/r2_url.ts since the component itself only
// signs and serves URLs through the S3 client.
export const r2 = new R2(components.r2);

// Public client API used by the browser via @convex-dev/r2/react's
// useUploadFile hook. The mutations here are intentionally not gated:
// auth lives on /api/ingest, which is the only path that turns an R2
// upload into a gallery asset row. Orphaned R2 objects (uploaded but
// never ingested) get cleaned up by a future janitor.
export const {
  generateUploadUrl,
  syncMetadata,
  getMetadata,
} = r2.clientApi<DataModel>();
