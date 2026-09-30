// Owner-scoped Convex functions (convex/actor.ts) take the actor from
// ctx.auth. Handler tests exercise the handler logic for a legitimate caller,
// so this signs the mock context in as the owner the call names (or a generic
// test actor for functions without an owner argument). A context that already
// carries `auth` is left alone, which is how tests model a different caller.
// The wrapper's own accept/reject rules are covered in tests/convex-actor-auth.test.ts.
export const TEST_ACTOR = "test-actor";

type Handler = { _handler: (ctx: never, args: never) => unknown };

const withIdentity = (ctx: unknown, args: unknown) => {
  if (ctx && typeof ctx === "object" && "auth" in ctx) return ctx;
  const record = (args ?? {}) as { ownerUserId?: unknown };
  const subject =
    typeof record.ownerUserId === "string" && record.ownerUserId.trim()
      ? record.ownerUserId.trim()
      : TEST_ACTOR;
  return {
    ...(ctx as object),
    auth: { getUserIdentity: async () => ({ subject }) },
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const callAsOwner = <F extends Handler>(fn: F) => (ctx: any, args?: any) =>
  (fn._handler as (ctx: unknown, args: unknown) => ReturnType<F["_handler"]>)(
    withIdentity(ctx, args),
    args,
  );
