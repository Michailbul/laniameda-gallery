import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";

// Component instance. Reads R2_BUCKET / R2_ENDPOINT / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY from Convex env. R2_PUBLIC_BASE_URL is read directly
// from process.env in hydration paths since the component itself only
// signs and serves URLs through the S3 client.
export const r2 = new R2(components.r2);
