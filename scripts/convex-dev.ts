import { spawn } from "node:child_process";

import { buildSanitizedConvexEnv } from "./lib/convex-dev-env";

const child = spawn("bunx", ["convex", "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: buildSanitizedConvexEnv(process.env),
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
