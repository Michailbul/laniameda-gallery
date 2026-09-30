import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createLocalJWKSet, jwtVerify } from "jose";
import { resolveOwnerArgs, requireActor } from "../convex/actor";
import { listFolders } from "../convex/folders";
import { generateUploadUrl } from "../convex/files";
import { resolveByTelegramId } from "../convex/users";
import {
  CONVEX_AUTH_AUDIENCE,
  CONVEX_AUTH_ISSUER,
  mintConvexActorToken,
  publicJwksFromPrivateKey,
} from "../lib/convex-auth";
import { mintConvexToken as mintSkillToken } from "../skills/laniameda-gallery/scripts/convex-auth";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const as = (subject: string | null) => ({
  auth: { getUserIdentity: async () => (subject ? { subject } : null) },
});

afterEach(() => {
  delete process.env.LEGACY_OWNER_ARG_AUTH;
});

describe("owner-scoped wrapper", () => {
  test("an anonymous caller is refused even with the right ownerUserId", async () => {
    await expect(resolveOwnerArgs(as(null), { ownerUserId: "owner-1" })).rejects.toThrow(
      "Not authenticated.",
    );
  });

  test("a caller naming someone else's ownerUserId is refused", async () => {
    await expect(
      resolveOwnerArgs(as("attacker"), { ownerUserId: "owner-1" }),
    ).rejects.toThrow("does not match");
  });

  test("a matching ownerUserId passes through with the caller's spelling", async () => {
    expect(await resolveOwnerArgs(as("telegram:42"), { ownerUserId: "42", x: 1 })).toEqual({
      ownerUserId: "42",
      x: 1,
    });
  });

  test("an omitted ownerUserId is filled from the token, so optional guards always run", async () => {
    expect(await resolveOwnerArgs(as("owner-1"), { id: "a" })).toEqual({
      id: "a",
      ownerUserId: "owner-1",
    });
  });

  test("legacy mode keeps the old behaviour only for unauthenticated calls", async () => {
    process.env.LEGACY_OWNER_ARG_AUTH = "true";
    expect(await resolveOwnerArgs(as(null), { ownerUserId: "owner-1" })).toEqual({
      ownerUserId: "owner-1",
    });
    await expect(
      resolveOwnerArgs(as("attacker"), { ownerUserId: "owner-1" }),
    ).rejects.toThrow("does not match");
  });

  test("registered functions enforce it end to end", async () => {
    const { ctx } = createMockConvexMutationCtx();
    await expect(
      listFolders._handler({ ...ctx, ...as(null) } as never, { ownerUserId: "owner-1" } as never),
    ).rejects.toThrow("Not authenticated.");
    await expect(
      listFolders._handler({ ...ctx, ...as("attacker") } as never, { ownerUserId: "owner-1" } as never),
    ).rejects.toThrow("does not match");
    await expect(
      listFolders._handler({ ...ctx, ...as("owner-1") } as never, { ownerUserId: "owner-1" } as never),
    ).resolves.toEqual([]);
  });

  test("upload URLs and user lookups need a signed-in actor", async () => {
    const { ctx } = createMockConvexMutationCtx();
    await expect(
      generateUploadUrl._handler({ ...ctx, ...as(null) } as never, {} as never),
    ).rejects.toThrow("Not authenticated.");
    await expect(requireActor(as("owner-1"))).resolves.toBe("owner-1");
    await expect(
      resolveByTelegramId._handler({ ...ctx, ...as("99") } as never, { telegramId: "42" } as never),
    ).rejects.toThrow("does not match");
    await expect(
      resolveByTelegramId._handler({ ...ctx, ...as("42") } as never, { telegramId: "42" } as never),
    ).resolves.toBeNull();
  });
});

describe("actor tokens", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwks = createLocalJWKSet(publicJwksFromPrivateKey(pem) as never);

  test("server and skill-script tokens verify against the published JWKS", async () => {
    for (const token of [
      mintConvexActorToken("telegram:42", { privateKeyPem: pem }),
      mintSkillToken("telegram:42", pem.replace(/\n/g, "\\n")),
    ]) {
      const { payload, protectedHeader } = await jwtVerify(token, jwks, {
        issuer: CONVEX_AUTH_ISSUER,
        audience: CONVEX_AUTH_AUDIENCE,
        algorithms: ["RS256"],
      });
      expect(payload.sub).toBe("telegram:42");
      expect(protectedHeader.kid).toBe("gallery-actor-1");
      expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
    }
  });

  test("a token signed with another key is rejected", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const forged = mintConvexActorToken("telegram:42", { privateKeyPem: other });
    await expect(jwtVerify(forged, jwks)).rejects.toThrow();
  });

  test("auth.config.ts and the signers agree on issuer and audience", () => {
    const config = readFileSync("convex/auth.config.ts", "utf8");
    expect(config).toContain(`applicationID: "${CONVEX_AUTH_AUDIENCE}"`);
    expect(config).toContain(`issuer: "${CONVEX_AUTH_ISSUER}"`);
    const skill = readFileSync("skills/laniameda-gallery/scripts/convex-auth.ts", "utf8");
    expect(skill).toContain(`"${CONVEX_AUTH_ISSUER}"`);
    expect(skill).toContain(`"${CONVEX_AUTH_AUDIENCE}"`);
  });
});

// Any public function that takes an owner must go through the owner wrappers.
// The exceptions below are guarded by a server/admin secret instead.
const SECRET_GUARDED = new Set([
  "agentTokens:createAgentToken",
  "agentTokens:listAgentTokens",
  "agentTokens:revokeAgentToken",
]);

test("no public Convex function trusts a caller-supplied ownerUserId", () => {
  const offenders: string[] = [];
  for (const file of readdirSync("convex")) {
    if (!file.endsWith(".ts") || file === "actor.ts") continue;
    const source = readFileSync(`convex/${file}`, "utf8");
    const exports = [
      ...source.matchAll(/export const (\w+)(?:\s*:[^=\n]+)?\s*=\s*(query|mutation|action)\(\{/g),
    ];
    for (const match of exports) {
      const body = source.slice(match.index! + match[0].length);
      const argsBlock = body.slice(0, body.indexOf("handler"));
      const validatorName = argsBlock.match(/args:\s*(\w+)/)?.[1];
      const validatorSource = validatorName
        ? (source.match(new RegExp(`const ${validatorName} = v\\.object\\(\\{[\\s\\S]*?\\n\\}\\);`))?.[0] ?? "")
        : "";
      const name = `${file.replace(/\.ts$/, "")}:${match[1]}`;
      if (/\bownerUserId\s*:/.test(argsBlock + validatorSource) && !SECRET_GUARDED.has(name)) {
        offenders.push(name);
      }
    }
  }
  expect(offenders).toEqual([]);
});
