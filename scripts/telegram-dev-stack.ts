import { spawn } from "node:child_process";

const main = async () => {
  const child = spawn("bun", ["scripts/dev-stack.ts", "--mode", "dev-telegram"], {
    stdio: "inherit",
    env: process.env,
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.once("exit", (code) => resolve(code ?? 0));
  });

  process.exitCode = exitCode;
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
