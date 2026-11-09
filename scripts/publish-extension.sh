#!/usr/bin/env bash
# Uploads and publishes extension/ at a git ref to the Chrome Web Store with the
# service account key (Chrome Web Store API v2). No gcloud needed: the token is
# minted with openssl. Used by the iMac's extension-sync when main gets a new
# version, and usable by hand.
#   scripts/publish-extension.sh <key.json> [ref=origin/main] [--status]
set -euo pipefail
KEY="$1"; REF="${2:-origin/main}"; MODE="${3:-}"
PUB="${CWS_PUBLISHER_ID:-7d243133-8afe-4b3f-83ca-3fffc5910bbe}"
ITEM="${CWS_EXTENSION_ID:-nlhmjpghlanlanpapgigmacjbnjoancb}"
API=https://chromewebstore.googleapis.com
ROOT="$(git rev-parse --show-toplevel)"
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
field() { /usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$KEY" "$1"; }
EMAIL="$(field client_email)"; PEM="$(mktemp)"; trap 'rm -f "$PEM"' EXIT
field private_key > "$PEM"
NOW=$(date +%s)
HEAD_B=$(printf '{"alg":"RS256","typ":"JWT"}' | b64)
CLAIM_B=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/chromewebstore","aud":"https://oauth2.googleapis.com/token","iat":%s,"exp":%s}' "$EMAIL" "$NOW" "$((NOW+3000))" | b64)
SIG=$(printf '%s.%s' "$HEAD_B" "$CLAIM_B" | openssl dgst -sha256 -sign "$PEM" | b64)
TOKEN=$(curl -fsS https://oauth2.googleapis.com/token -d grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer -d assertion="$HEAD_B.$CLAIM_B.$SIG" \
  | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
AUTH="Authorization: Bearer $TOKEN"
status() { curl -fsS -H "$AUTH" "$API/v2/publishers/$PUB/items/$ITEM:fetchStatus"; }
if [ "$MODE" = "--status" ]; then status | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin);d.pop("publicKey",None);print(json.dumps(d,indent=1))'; exit 0; fi
ZIP="$("$ROOT/scripts/package-extension.sh" "$REF")"
UP=$(curl -sS -X POST -H "$AUTH" -H "Content-Type: application/zip" --data-binary @"$ZIP" "$API/upload/v2/publishers/$PUB/items/$ITEM:upload")
echo "upload: $UP"
echo "$UP" | grep -q '"error"' && { echo "upload refused"; exit 1; }
for i in $(seq 1 30); do
  STATE=$(status | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("lastAsyncUploadState","SUCCEEDED"))')
  [ "$STATE" = "SUCCEEDED" ] && break
  [ "$STATE" = "FAILED" ] && { echo "upload failed"; exit 1; }
  sleep 10
done
PUBRES=$(curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{}' "$API/v2/publishers/$PUB/items/$ITEM:publish")
echo "publish: $PUBRES"
echo "$PUBRES" | grep -q '"error"' && exit 1 || exit 0
