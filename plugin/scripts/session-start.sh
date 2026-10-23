#!/bin/sh
# laniameda-gallery SessionStart hook.
# Prints a short factual context block. Never fails the session: always exits 0.
# The token is read from the environment and is never printed.

ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
ENDPOINT="https://gallery.laniameda.space/api/mcp"
TOKEN="${CLAUDE_PLUGIN_OPTION_GALLERY_TOKEN:-}"

VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/.claude-plugin/plugin.json" 2>/dev/null | head -n 1)
[ -n "$VERSION" ] || VERSION="unknown"

echo "laniameda-gallery plugin $VERSION (gallery MCP server: gallery, skill: gallery-worlds)."

if [ -z "$TOKEN" ]; then
  echo "Gallery token: not set. The gallery MCP tools will answer 401 until a token from https://gallery.laniameda.space/agents is saved in /plugin -> laniameda-gallery -> configure."
  exit 0
fi
echo "Gallery token: set."

if ! command -v curl >/dev/null 2>&1; then
  echo "Gallery status: not checked (curl is not installed)."
  exit 0
fi

BODY='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"open_world","arguments":{}}}'
RESPONSE=$(curl -s -m 4 -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d "$BODY" 2>/dev/null)

if [ -z "$RESPONSE" ]; then
  echo "Gallery status: unreachable (no answer within 4 s). The MCP tools may still connect later."
  exit 0
fi

case "$RESPONSE" in
  *invalid_token*|*Unauthorized*|*'"error":"unauthorized"'*)
    echo "Gallery status: the token was rejected (401). A new token can be created at https://gallery.laniameda.space/agents."
    exit 0 ;;
esac

case "$RESPONSE" in
  *'"isError":true'*|*'"error":{'*)
    echo "Gallery status: reachable. open_world is not deployed on the server yet, so the world list is unavailable this session."
    exit 0 ;;
esac

# SSE responses carry the JSON on "data:" lines.
JSON=$(printf '%s\n' "$RESPONSE" | sed -n 's/^data: //p')
[ -n "$JSON" ] || JSON="$RESPONSE"

WORLDS=""
if command -v bun >/dev/null 2>&1; then
  WORLDS=$(printf '%s' "$JSON" | bun -e '
    const raw = await Bun.stdin.text();
    try {
      const msg = JSON.parse(raw);
      const text = (msg.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : (data.worlds ?? []);
      const rows = list.filter((w) => w && w.key).slice(0, 14).map((w) => `${w.key} (${w.name ?? w.key})`);
      console.log(rows.join(", "));
    } catch { console.log(""); }
  ' 2>/dev/null)
fi
if [ -z "$WORLDS" ]; then
  # Fallback: the tool result text is JSON inside a JSON string, so its quotes are escaped.
  WORLDS=$(printf '%s' "$JSON" | grep -o '\\"key\\": *\\"[^\\]*' | sed 's/.*\\"//' | head -n 14 | tr '\n' ' ' | sed 's/ $//; s/ /, /g')
fi

if [ -n "$WORLDS" ]; then
  echo "Gallery status: reachable. Worlds: $WORLDS."
  echo "World work starts with open_world {world: <key>}; the gallery-worlds skill describes the loop."
else
  echo "Gallery status: reachable. The world list could not be read from open_world."
fi
exit 0
