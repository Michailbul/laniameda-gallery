import {
  corsPreflight,
  oauthErrorResponse,
  oauthJson,
  registerClient,
} from "@/lib/server/mcp-oauth";

// RFC 7591 dynamic client registration. Open by design: registering only buys a
// client the right to ask; the owner still has to sign in and approve.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return oauthJson(await registerClient(body), 201);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export const OPTIONS = corsPreflight;
