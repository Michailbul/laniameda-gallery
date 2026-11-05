import { ConvexHttpClient } from "convex/browser";

// Operator scripts run against the canonical gallery deployment only, with an
// admin or deploy key from the environment. Anything else fails before a call.
export const CANONICAL_CONVEX_URL = "https://perfect-buffalo-375.convex.cloud";
export const CANONICAL_CONVEX_DEPLOYMENT = "dev:perfect-buffalo-375";

export const createCanonicalAdminClient = (env: NodeJS.ProcessEnv = process.env) => {
  const urls = [env.CONVEX_URL, env.NEXT_PUBLIC_CONVEX_URL]
    .map((value) => value?.trim()).filter(Boolean);
  if (urls.length === 0 || urls.some((url) => url !== CANONICAL_CONVEX_URL)) {
    throw new Error("Set CONVEX_URL to the canonical gallery deployment; resolve any conflicting NEXT_PUBLIC_CONVEX_URL first.");
  }
  if (env.CONVEX_DEPLOYMENT && env.CONVEX_DEPLOYMENT !== CANONICAL_CONVEX_DEPLOYMENT) {
    throw new Error("CONVEX_DEPLOYMENT conflicts with the canonical gallery deployment.");
  }
  const key = env.CONVEX_ADMIN_KEY?.trim() || env.CONVEX_DEPLOY_KEY?.trim();
  if (!key) throw new Error("CONVEX_ADMIN_KEY or CONVEX_DEPLOY_KEY is required.");
  const client = new ConvexHttpClient(CANONICAL_CONVEX_URL);
  (client as ConvexHttpClient & { setAdminAuth(token: string): void }).setAdminAuth(key);
  return client;
};

export const readFlag = (args: string[], name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
