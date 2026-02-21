# Authentication Overview



## Current Implementation

- **WorkOS AuthKit** is the source of truth: the app uses the hosted AuthKit UI (via `@workos-inc/authkit-nextjs`) to sign users in, while Convex relies on the tokens from AuthKit for guardrails.
- **Client flow**: `components/ConvexClientProvider.tsx` (mounted in `app/layout.tsx`) wraps every page in `<AuthKitProvider>` → `<ConvexProviderWithAuthKit>`. `useAuth()` and `useAccessToken()` keep the token doc stable and forward it to Convex, while `ConvexProviderWithAuthKit` exposes `useConvexAuth()` for downstream guards.
- **Routes/middleware**: `middleware.ts` applies `authkitMiddleware()` with `middlewareAuth.enabled = false`, so the app is publicly browsable without auth redirects. `app/sign-in/route.ts` and `app/sign-up/route.ts` still support optional sign-in/up via WorkOS, and WorkOS posts back to `/callback` (handled by the middleware).
- **Authorization config**: `convex/auth.config.ts` declares two `customJwt` providers that point at WorkOS’s JWKS, so Convex can verify AuthKit tokens. The Convex deployment needs the `WORKOS_CLIENT_ID` env var, while the frontend needs `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_WORKOS_CLIENT_ID`, and `NEXT_PUBLIC_WORKOS_REDIRECT_URI`.
- **UI gating**: `app/page.tsx` renders the gallery canvas for every visitor in guest mode. Authentication prompts should appear only when a protected interaction is attempted (for example: like, save, upload, or edit).
- **AI API gating**: `/api/ai/*` route handlers enforce `withAuth({ ensureSignedIn: true })`, so generation and run-control actions require authenticated users even though browsing remains public.

## Desired Pattern

### Short-term goal
1. **Open gallery browsing for everyone**: The masonry canvas should render for any visitor so they can feel the value. They can scroll, preview tiles, and appreciate the visual collection without signing in.
2. **Prompt auth only on protected interactions**: Actions such as liking, saving, uploading, or editing prompts should detect `useConvexAuth()` from `ConvexProviderWithAuthKit`. If the user is not authenticated, show auth prompts inline at the interaction point (not as a global page-level paywall).
3. **Progressive onboarding**: Clicking any interaction CTA routes them through `/sign-in` → WorkOS AuthKit, and the middleware already handles the callback. After login, the UI should re-render with `<Authenticated>` content (actions enabled) while still keeping the gallery visible.

### Permissions/scopes
- Use WorkOS’s default AuthKit scopes for now; Convex can read the JWT claims it needs once `ctx.auth.getUserIdentity()` is available. No additional roles are enforced yet, but we can map `ctx.auth.getUserIdentity()?.email` to a “viewer cluster” and add roles later.
- Store any future metadata (like “liked by this user”) in Convex tables that reference the `ctx.auth.getUserIdentity()?.id`. Guard mutations behind `Authenticated` to ensure they only run when `isAuthenticated` is true.

### Next steps
1. Refactor `app/page.tsx` to remove the strict `<Authenticated>` wrapper around the gallery, replacing it with conditional action overlays. Keep `<Unauthenticated>` for dev notes but allow the canvas to render unconditionally.
2. Build an `AuthGate` component that wraps interactive buttons and displays the sign-in prompt when `isAuthenticated` is false.
3. Keep the server-side Convex auth config as-is but document the needed env vars in `.env.example`/deployment notes. We can extend with finer-grained permissions later (e.g., “curator” vs. “viewer”) once the user model grows.
