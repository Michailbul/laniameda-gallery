import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "crypto";
import {
  isAuthDateFresh,
  parseTelegramWidgetData,
  verifyTelegramAuth,
  type TelegramWidgetData,
} from "@/lib/telegram-auth";

function computeWidgetHash(data: Omit<TelegramWidgetData, "hash">, botToken: string): string {
  const rows = Object.entries(data)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHash("sha256").update(botToken).digest();
  return createHmac("sha256", secret).update(rows).digest("hex");
}

describe("parseTelegramWidgetData", () => {
  test("accepts valid payload and trims optional strings", () => {
    const parsed = parseTelegramWidgetData({
      id: "123",
      first_name: "  Michael  ",
      last_name: "  Doe ",
      username: "  laniameda ",
      photo_url: " https://example.com/photo.jpg ",
      auth_date: "1710000000",
      hash: "a".repeat(64),
    });

    expect(parsed).toEqual({
      id: 123,
      first_name: "Michael",
      last_name: "Doe",
      username: "laniameda",
      photo_url: "https://example.com/photo.jpg",
      auth_date: 1710000000,
      hash: "a".repeat(64),
    });
  });

  test("rejects non-positive or unsafe integer fields", () => {
    expect(
      parseTelegramWidgetData({
        id: 0,
        first_name: "A",
        auth_date: 1710000000,
        hash: "a".repeat(64),
      }),
    ).toBeNull();

    expect(
      parseTelegramWidgetData({
        id: "9007199254740992",
        first_name: "A",
        auth_date: 1710000000,
        hash: "a".repeat(64),
      }),
    ).toBeNull();

    expect(
      parseTelegramWidgetData({
        id: 123,
        first_name: "A",
        auth_date: -1,
        hash: "a".repeat(64),
      }),
    ).toBeNull();
  });
});

describe("verifyTelegramAuth", () => {
  test("validates Telegram HMAC correctly", () => {
    const botToken = "123456:TEST_BOT_TOKEN";
    const baseData = {
      id: 123,
      first_name: "Michael",
      username: "laniameda",
      auth_date: 1710000000,
    } satisfies Omit<TelegramWidgetData, "hash">;

    const hash = computeWidgetHash(baseData, botToken);

    expect(verifyTelegramAuth({ ...baseData, hash }, botToken)).toBeTrue();
    expect(
      verifyTelegramAuth(
        {
          ...baseData,
          hash: `${hash.slice(0, 63)}${hash[63] === "a" ? "b" : "a"}`,
        },
        botToken,
      ),
    ).toBeFalse();
  });
});

describe("isAuthDateFresh", () => {
  test("enforces max age and future skew", () => {
    const now = Math.floor(Date.now() / 1000);

    expect(isAuthDateFresh(now - 30, 60, 60)).toBeTrue();
    expect(isAuthDateFresh(now - 61, 60, 60)).toBeFalse();
    expect(isAuthDateFresh(now + 30, 60, 10)).toBeFalse();
  });
});
