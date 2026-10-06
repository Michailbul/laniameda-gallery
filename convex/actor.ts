import { ConvexError } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { canActorAccessByUserId, resolveUserIdCandidates } from "./authz";

// Every public function that reads or writes one owner's data is registered
// through ownerQuery / ownerMutation / ownerAction instead of the raw builders.
//
// The actor comes from ctx.auth: a JWT minted by trusted code holding
// CONVEX_AUTH_PRIVATE_KEY (see lib/convex-auth.ts). The `ownerUserId` argument
// is kept so existing callers and handler bodies stay unchanged, but it is no
// longer trusted on its own:
//   - supplied and matching the token subject -> passed through as-is (the
//     caller's spelling decides which index value the handler queries)
//   - supplied and not matching               -> rejected
//   - omitted                                 -> filled in with the subject, so
//     `if (args.ownerUserId && ...)` guards can no longer be skipped
//
// LEGACY_OWNER_ARG_AUTH=true restores the old caller-supplied-owner behaviour
// for unauthenticated calls. It exists only to bridge the Convex deploy and
// the Vercel deploy (one deployment serves both); turn it off right after.

type AuthCtx = {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

export const isLegacyOwnerArgAuthEnabled = () =>
  process.env.LEGACY_OWNER_ARG_AUTH?.trim().toLowerCase() === "true";

const readIdentitySubject = async (ctx: AuthCtx) => {
  const identity = await ctx.auth?.getUserIdentity();
  const subject = identity?.subject?.trim();
  return subject || undefined;
};

// For functions with no owner argument that still must not be open to the
// world (upload URLs, the shared tag vocabulary, the users table).
// Returns undefined only in legacy mode.
export const requireActor = async (ctx: AuthCtx): Promise<string | undefined> => {
  const subject = await readIdentitySubject(ctx);
  if (subject) return subject;
  if (isLegacyOwnerArgAuthEnabled()) return undefined;
  throw new ConvexError("Not authenticated.");
};

export const actorMatchesUserId = (actor: string, userId: string) =>
  canActorAccessByUserId(userId, resolveUserIdCandidates(actor));

export const resolveOwnerArgs = async <Args extends Record<string, unknown>>(
  ctx: AuthCtx,
  args: Args,
): Promise<Args> => {
  const subject = await readIdentitySubject(ctx);
  if (!subject) {
    if (isLegacyOwnerArgAuthEnabled()) return args;
    throw new ConvexError("Not authenticated.");
  }

  const supplied =
    typeof args.ownerUserId === "string" ? args.ownerUserId.trim() : "";
  if (!supplied) {
    return { ...args, ownerUserId: subject };
  }
  if (!actorMatchesUserId(subject, supplied)) {
    throw new ConvexError("ownerUserId does not match the signed-in user.");
  }
  return args;
};

type AnyHandler = (ctx: AuthCtx, args: Record<string, unknown>) => unknown;
type AnyDefinition = { handler: AnyHandler; [key: string]: unknown };

const withOwnerArgs = (definition: AnyDefinition): AnyDefinition => {
  if (typeof definition === "function") {
    throw new Error("owner-scoped functions must use the object form with args.");
  }
  return {
    ...definition,
    handler: async (ctx, args) =>
      definition.handler(ctx, await resolveOwnerArgs(ctx, args ?? {})),
  };
};

const withActor = (definition: AnyDefinition): AnyDefinition => ({
  ...definition,
  handler: async (ctx, args) => {
    await requireActor(ctx);
    return definition.handler(ctx, args);
  },
});

// The casts keep each builder's full argument/return inference for callers.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const ownerQuery = ((definition: any) =>
  query(withOwnerArgs(definition) as any)) as typeof query;
export const ownerMutation = ((definition: any) =>
  mutation(withOwnerArgs(definition) as any)) as typeof mutation;
export const ownerAction = ((definition: any) =>
  action(withOwnerArgs(definition) as any)) as typeof action;
export const authedMutation = ((definition: any) =>
  mutation(withActor(definition) as any)) as typeof mutation;
// New private text cannot rely on the legacy rollout switch used by old data.
const withSignedOwner = (definition: AnyDefinition): AnyDefinition => ({
  ...definition,
  handler: async (ctx, args) => {
    if (!await readIdentitySubject(ctx)) throw new ConvexError("Not authenticated.");
    return definition.handler(ctx, await resolveOwnerArgs(ctx, args ?? {}));
  },
});
export const signedOwnerQuery = ((definition: any) =>
  query(withSignedOwner(definition) as any)) as typeof query;
export const signedOwnerMutation = ((definition: any) =>
  mutation(withSignedOwner(definition) as any)) as typeof mutation;
/* eslint-enable @typescript-eslint/no-explicit-any */
