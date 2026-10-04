#!/bin/sh
# headersHelper for the laniameda-gallery server in the repo's .mcp.json.
#
# The static header there is `Bearer ${LANIAMEDA_GALLERY_AGENT_TOKEN}`. The
# Claude desktop app starts Claude Code without the shell profile, so the
# variable is unset and the placeholder goes out as written (HTTP 401). Claude
# Code also runs a project-scope helper with every credential-looking variable
# (TOKEN, KEY, SECRET, AUTH, PASSWORD) removed, so this cannot read the
# variable either. It reads the file the shell profile sources.
#
# With the file:    {"Authorization": "Bearer <token>"}, which overrides the
#                   static header.
# Without the file: {}, so the static header applies. That is a cloud sandbox,
#                   where the variable is set and the file does not exist.
#
# stdout carries the header JSON and nothing else. The token is never logged.

ENV_FILE="${HOME:-}/.config/laniameda/gallery.env"

if [ ! -r "$ENV_FILE" ]; then
  printf '{}\n'
  exit 0
fi

# Sourced in a subshell: a broken gallery.env ends the subshell, the token
# comes back empty and the static header still applies.
TOKEN=$(
  {
    unset LANIAMEDA_GALLERY_AGENT_TOKEN
    . "$ENV_FILE" >/dev/null
    printf '%s' "${LANIAMEDA_GALLERY_AGENT_TOKEN:-}"
  } 2>/dev/null
)

# Only bearer-token characters (RFC 6750) go into the JSON, so nothing needs
# escaping.
case "$TOKEN" in
  '' | *[!A-Za-z0-9._~+/=-]*)
    echo "laniameda-gallery: no usable LANIAMEDA_GALLERY_AGENT_TOKEN in $ENV_FILE" >&2
    printf '{}\n'
    ;;
  *)
    printf '{"Authorization": "Bearer %s"}\n' "$TOKEN"
    ;;
esac
