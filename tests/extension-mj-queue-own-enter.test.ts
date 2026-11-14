import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Midjourney flagged the account as a bot on 14 Nov 2026 while the queue
// pressed Enter for Michael. The page script must only ever react to his own
// (trusted) Enter, never synthesise one.
describe("MJ queue sends only on Michael's own Enter", () => {
  const source = readFileSync(join(import.meta.dir, "..", "extension", "mj-queue.js"), "utf8");

  test("no scripted keyboard events", () => {
    expect(source).not.toMatch(/new KeyboardEvent\(/);
  });

  test("the send path listens for a trusted Enter", () => {
    expect(source).toMatch(/event\.isTrusted/);
    expect(source).toMatch(/readyForEnter/);
  });
});
