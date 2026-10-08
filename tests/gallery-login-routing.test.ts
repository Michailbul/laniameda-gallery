import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { proxy } from "../proxy";
import { SESSION_COOKIE, SESSION_RENEW_AFTER, signSession } from "../lib/session-jwt";

const originalEnv = {
  SESSION_SECRET: process.env.SESSION_SECRET,
  VERCEL_ENV: process.env.VERCEL_ENV,
  APP_CANONICAL_HOST: process.env.APP_CANONICAL_HOST,
};
const testSecret = "gallery-routing-test-secret-32-chars-minimum";

beforeEach(() => {
  process.env.SESSION_SECRET = testSecret;
  process.env.VERCEL_ENV = "production";
  process.env.APP_CANONICAL_HOST = "gallery.laniameda.space";
});
afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(path = "/", token?: string, host = "gallery.laniameda.space") {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host, ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) },
  });
}

describe("gallery login routing", () => {
  test("signed-out root and auth-error returns reach the gallery login instead of the profile", async () => {
    for (const path of ["/", "/?tgAuthError=expired", "/?asset=shared-piece"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  test("invalid and expired sessions still reach login without being renewed", async () => {
    const expired = await new SignJWT({ telegramId: "test-owner", firstName: "Test" })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt(1).setExpirationTime(2)
      .sign(new TextEncoder().encode(testSecret));
    for (const token of ["invalid-cookie", expired]) {
      const response = await proxy(request("/", token));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  test("authenticated navigation keeps the gallery root and sliding renewal", async () => {
    const recent = await signSession({ telegramId: "test-owner", firstName: "Test" });
    const fresh = await proxy(request("/", recent));
    expect(fresh.headers.get("location")).toBeNull();
    expect(fresh.headers.get("set-cookie")).toBeNull();
    const old = await new SignJWT({ telegramId: "test-owner", firstName: "Test" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - SESSION_RENEW_AFTER - 10)
      .setExpirationTime("1h").sign(new TextEncoder().encode(testSecret));
    const renewed = await proxy(request("/", old));
    expect(renewed.headers.get("x-middleware-next")).toBe("1");
    expect(renewed.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  test("Vercel aliases canonicalize the root and preserve login errors", async () => {
    const response = await proxy(request("/?tgAuthError=invalid_hash", undefined, "preview.vercel.app"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://gallery.laniameda.space/?tgAuthError=invalid_hash");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("public pages and callback paths retain their own routes", async () => {
    for (const path of ["/misha.buloy/selected_work/featured", "/admin", "/api/auth/telegram?returnTo=%2F"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  });
});
