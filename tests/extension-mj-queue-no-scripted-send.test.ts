import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Midjourney blocked the account as a bot on 14 Nov 2026 while the queue sent
// a scripted Enter. A scripted click or submit is just as untrusted, so the
// queue never presses, clicks or submits anything on Midjourney (lead
// decision, 17 Nov 2026): only Michael's own Enter or click sends a job.
const files = ["mj-queue.js", "mj-queue-panel.js"].map((name) => ({
  name,
  source: readFileSync(join(import.meta.dir, "..", "extension", name), "utf8")
    // Comments may talk about clicks; only code counts.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1"),
}));

describe("the MJ queue never sends for Michael", () => {
  for (const { name, source } of files) {
    test(`${name}: no scripted click or submit`, () => {
      expect(source).not.toMatch(/\.click\s*\(/);
      expect(source).not.toMatch(/requestSubmit\s*\(/);
      expect(source).not.toMatch(/\.submit\s*\(/);
    });

    test(`${name}: no synthetic keyboard, mouse or pointer events`, () => {
      expect(source).not.toMatch(/new\s+(Keyboard|Mouse|Pointer|Submit)Event\s*\(/);
    });

    test(`${name}: dispatchEvent only tells React the bar's text changed`, () => {
      const calls = source.match(/dispatchEvent\s*\([^)]*\)?/g) || [];
      for (const call of calls) expect(call).toMatch(/^dispatchEvent\(new Event\("(input|change)", \{ bubbles: true \}/);
    });
  }

  test("his own Enter and his own click on Midjourney's send button are what count", () => {
    const page = files[0].source;
    expect(page).toMatch(/event\.isTrusted/);
    expect(page).toMatch(/beginSend\(area\.value, "enter", false\)/);
    expect(page).toMatch(/beginSend\(area\.value, "click", true\)/);
  });
});
