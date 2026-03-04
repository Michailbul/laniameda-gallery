import { expect, test } from "bun:test";
import {
  canActorAccessByUserId,
  parseUserIdList,
  resolveUserIdCandidates,
} from "../lib/identity";

test("resolveUserIdCandidates includes telegram and unprefixed variants", () => {
  expect(resolveUserIdCandidates("278674008")).toEqual([
    "278674008",
    "telegram:278674008",
  ]);

  expect(resolveUserIdCandidates("telegram:278674008")).toEqual([
    "telegram:278674008",
    "278674008",
  ]);

  expect(resolveUserIdCandidates("  ")).toEqual([]);
});

test("parseUserIdList trims and filters empty entries", () => {
  expect(parseUserIdList("  a, b ,, telegram:1, ")).toEqual([
    "a",
    "b",
    "telegram:1",
  ]);

  expect(parseUserIdList(undefined)).toEqual([]);
});

test("canActorAccessByUserId matches across prefixed/unprefixed forms", () => {
  expect(canActorAccessByUserId("278674008", ["telegram:278674008"])).toBeTrue();
  expect(canActorAccessByUserId("telegram:278674008", ["278674008"])).toBeTrue();
  expect(canActorAccessByUserId("other", ["278674008"])).toBeFalse();
  expect(canActorAccessByUserId("", ["278674008"])).toBeFalse();
  expect(canActorAccessByUserId("278674008", [])).toBeFalse();
});
