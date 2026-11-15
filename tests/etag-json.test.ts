import { describe, expect, test } from "bun:test";
import { etagJson } from "../lib/server/etag-json";

describe("etagJson", () => {
  const body = { ok: true, items: [{ id: "a", prompt: "x".repeat(1000) }] };

  test("sends the body with an ETag the first time", async () => {
    const res = etagJson(new Request("https://g.test/api"), body, { "Access-Control-Allow-Origin": "*" });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^W\/".+"$/);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual(body);
  });

  test("answers an unchanged poll with an empty 304", async () => {
    const etag = etagJson(new Request("https://g.test/api"), body).headers.get("etag")!;
    const res = etagJson(new Request("https://g.test/api", { headers: { "If-None-Match": etag } }), body);
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  test("sends the new body once the data changes", async () => {
    const etag = etagJson(new Request("https://g.test/api"), body).headers.get("etag")!;
    const res = etagJson(new Request("https://g.test/api", { headers: { "If-None-Match": etag } }), { ...body, ok: false });
    expect(res.status).toBe(200);
  });
});
