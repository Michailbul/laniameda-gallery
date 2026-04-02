const isSuspiciousConvexTokenFragment = (key: string, value: string | undefined) => {
  if (value !== "" || !key.startsWith("ey")) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(`${key}=`, "base64").toString("utf8"));
    return Boolean(decoded && typeof decoded === "object" && "v2" in decoded);
  } catch {
    return false;
  }
};

export const buildSanitizedConvexEnv = (baseEnv: NodeJS.ProcessEnv) => {
  const nextEnv = { ...baseEnv } as NodeJS.ProcessEnv;

  delete nextEnv.CONVEX_DEPLOY_KEY;
  delete nextEnv.CONVEX_DEPLOYMENT;
  delete nextEnv.CONVEX_SITE_URL;
  delete nextEnv.CONVEX_URL;
  delete nextEnv.NEXT_PUBLIC_CONVEX_URL;

  for (const [key, value] of Object.entries(baseEnv)) {
    if (isSuspiciousConvexTokenFragment(key, value)) {
      delete nextEnv[key];
    }
  }

  return nextEnv;
};
