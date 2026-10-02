import {
  corsPreflight,
  oauthJson,
  originFromRequest,
  protectedResourceMetadata,
} from "@/lib/server/mcp-oauth";

// RFC 9728. Served both bare and path-suffixed (/.well-known/oauth-protected-resource/api/mcp),
// which is where MCP clients look for the metadata of https://<host>/api/mcp.
export function GET(request: Request) {
  return oauthJson(protectedResourceMetadata(originFromRequest(request)));
}

export const OPTIONS = corsPreflight;
