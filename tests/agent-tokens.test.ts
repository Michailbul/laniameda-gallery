import { beforeEach, describe, expect, test } from "bun:test";

import {
  authenticateAgentToken,
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from "../convex/agentTokens";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("agent tokens", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
    process.env.AGENT_TOKEN_ISSUER_SECRET = "issuer-secret";
  });

  test("creates public token metadata without returning tokenHash", async () => {
    const token = await createAgentToken._handler(harness.ctx as never, {
      serverSecret: "issuer-secret",
      ownerUserId: "telegram:278674008",
      tokenHash: "hashed-token",
      tokenPrefix: "lgat_prefix",
      label: "Codex",
      scopes: ["gallery:read", "gallery:write"],
    });

    expect(token.ownerUserId).toBe("telegram:278674008");
    expect(token.scopes).toEqual(["gallery:read", "gallery:write"]);
    expect("tokenHash" in token).toBe(false);

    const tokens = await listAgentTokens._handler(harness.ctx as never, {
      serverSecret: "issuer-secret",
      ownerUserId: "telegram:278674008",
    });
    expect(tokens).toHaveLength(1);
    expect("tokenHash" in tokens[0]!).toBe(false);
  });

  test("authenticates scoped tokens and rejects missing scopes", async () => {
    await createAgentToken._handler(harness.ctx as never, {
      serverSecret: "issuer-secret",
      ownerUserId: "user-1",
      tokenHash: "hashed-token",
      tokenPrefix: "lgat_prefix",
      scopes: ["gallery:read"],
    });

    const readAuth = await authenticateAgentToken._handler(harness.ctx as never, {
      tokenHash: "hashed-token",
      requiredScope: "gallery:read",
    });
    expect(readAuth?.ownerUserId).toBe("user-1");

    const writeAuth = await authenticateAgentToken._handler(harness.ctx as never, {
      tokenHash: "hashed-token",
      requiredScope: "gallery:write",
    });
    expect(writeAuth).toBeNull();
  });

  test("revoked tokens no longer authenticate", async () => {
    const token = await createAgentToken._handler(harness.ctx as never, {
      serverSecret: "issuer-secret",
      ownerUserId: "user-1",
      tokenHash: "hashed-token",
      tokenPrefix: "lgat_prefix",
      scopes: ["gallery:read"],
    });

    await revokeAgentToken._handler(harness.ctx as never, {
      serverSecret: "issuer-secret",
      ownerUserId: "user-1",
      tokenId: token._id,
    });

    const auth = await authenticateAgentToken._handler(harness.ctx as never, {
      tokenHash: "hashed-token",
      requiredScope: "gallery:read",
    });
    expect(auth).toBeNull();
  });
});
