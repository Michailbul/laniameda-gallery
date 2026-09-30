import { ConvexHttpClient } from "convex/browser";
import {
  mintConvexActorToken,
  resolveConvexAuthPrivateKey,
} from "@/lib/convex-auth";

const resolveConvexUrl = () => {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("CONVEX_URL is not configured.");
  }
  return url;
};

// Signs a Convex token for an actor this server has already authenticated
// (session cookie, agent token or extension token). Returns undefined when
// CONVEX_AUTH_PRIVATE_KEY is not set, which only works while Convex still has
// LEGACY_OWNER_ARG_AUTH on during the rollout.
export const mintServerActorToken = (actorUserId: string) => {
  const privateKeyPem = resolveConvexAuthPrivateKey();
  if (!privateKeyPem) return undefined;
  return mintConvexActorToken(actorUserId, { privateKeyPem });
};

// `actorUserId` must come from this server's own auth check, never from the
// request body: Convex treats it as the signed-in user. Omit it only for
// public reads and secret-guarded functions (agent tokens, runs, curation).
export const getServerConvexClient = (actorUserId?: string) => {
  const client = new ConvexHttpClient(resolveConvexUrl());
  const actor = actorUserId?.trim();
  if (actor) {
    const token = mintServerActorToken(actor);
    if (token) client.setAuth(token);
  }
  return client;
};
