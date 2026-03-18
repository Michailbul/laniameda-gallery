// Convex auth is intentionally disabled for now.
// The live app authenticates in Next.js via Telegram session cookies and
// resolves the Convex owner on the server before calling backend functions.
const authConfig = { providers: [] };

export default authConfig;
