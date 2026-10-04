import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// skills/laniameda-gallery/scripts/mcp-headers.sh is the headersHelper of the
// repo's .mcp.json. Claude Code runs it from the repo root with credential
// variables removed, so it is exercised here as a real subprocess with HOME
// pointed at a scratch directory.

const REPO_ROOT = join(import.meta.dir, "..");
const HELPER = "skills/laniameda-gallery/scripts/mcp-headers.sh";
const TOKEN = "lgat_test-token.v1";

function homeWith(envFile?: string) {
  const home = mkdtempSync(join(tmpdir(), "gallery-mcp-headers-"));
  if (envFile !== undefined) {
    mkdirSync(join(home, ".config", "laniameda"), { recursive: true });
    writeFileSync(join(home, ".config", "laniameda", "gallery.env"), envFile);
  }
  return home;
}

function runHelper(home: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(["sh", HELPER], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? "", HOME: home, ...env },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("gallery MCP headers helper", () => {
  test(".mcp.json keeps the static header and runs the helper", () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, ".mcp.json"), "utf8"));
    const server = config.mcpServers["laniameda-gallery"];

    expect(server.headers.Authorization).toBe("Bearer ${LANIAMEDA_GALLERY_AGENT_TOKEN}");
    expect(server.headersHelper).toBe(`sh ${HELPER}`);
    expect(existsSync(join(REPO_ROOT, HELPER))).toBe(true);
  });

  test("reads the token from gallery.env", () => {
    const home = homeWith(`export LANIAMEDA_GALLERY_AGENT_TOKEN=${TOKEN}\n`);
    const { exitCode, stdout } = runHelper(home);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  test("accepts a quoted value", () => {
    const home = homeWith(`export LANIAMEDA_GALLERY_AGENT_TOKEN="${TOKEN}"\n`);

    expect(JSON.parse(runHelper(home).stdout)).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  test("prints {} without gallery.env, even when the variable is set", () => {
    const { exitCode, stdout, stderr } = runHelper(homeWith(), {
      LANIAMEDA_GALLERY_AGENT_TOKEN: TOKEN,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
    expect(stderr).toBe("");
  });

  test("prints {} when gallery.env has no usable token", () => {
    const cases = [
      "export SOMETHING_ELSE=1\n",
      "export LANIAMEDA_GALLERY_AGENT_TOKEN=\n",
      `export LANIAMEDA_GALLERY_AGENT_TOKEN='lgat_"quoted"'\n`,
      "export LANIAMEDA_GALLERY_AGENT_TOKEN='two words'\n",
      "this is not a shell file (\n",
    ];

    for (const envFile of cases) {
      const { exitCode, stdout, stderr } = runHelper(homeWith(envFile), {
        LANIAMEDA_GALLERY_AGENT_TOKEN: TOKEN,
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({});
      expect(stderr).not.toContain("lgat_");
    }
  });
});
