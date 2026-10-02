import {
  authorizationServerMetadata,
  corsPreflight,
  oauthJson,
  originFromRequest,
} from "@/lib/server/mcp-oauth";

// RFC 8414 authorization server metadata for the MCP OAuth flow.
export function GET(request: Request) {
  return oauthJson(authorizationServerMetadata(originFromRequest(request)));
}

export const OPTIONS = corsPreflight;
