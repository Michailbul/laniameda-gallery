#!/bin/bash
# Installs (or updates) the laniameda writer bridge on this Mac: copies writer.py
# to ~/.config/laniameda/writer, lists the extension copies allowed to call it,
# and keeps it running with a LaunchAgent. Safe to run again.
#   extension-writer/install.sh            install or update
#   extension-writer/install.sh --remove   stop and remove the LaunchAgent
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.config/laniameda/writer"
LABEL="com.laniameda.writer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/laniameda-writer.log"

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"; echo "writer removed (files stay in $DIR)"; exit 0
fi

mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$HERE/writer.py" "$DIR/writer.py"; chmod 700 "$DIR/writer.py"

/usr/bin/python3 - "$DIR/config.json" <<'PY'
import glob, hashlib, json, os, sys
path = sys.argv[1]; home = os.path.expanduser("~")
conf = {}
try: conf = json.load(open(path))
except (OSError, ValueError): pass
ids = set(conf.get("extensions") or []) | {"nlhmjpghlanlanpapgigmacjbnjoancb"}  # the Chrome Web Store copy
def unpacked_id(folder):  # Chrome names an unpacked extension after its folder path
    digest = hashlib.sha256(folder.encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(ch, 16)) for ch in digest)
for folder in (home + "/michailbul/extensions/save-to-gallery", home + "/AI-video-work/laniameda/laniameda.gallery/extension"):
    if os.path.isdir(folder): ids.add(unpacked_id(os.path.realpath(folder))); ids.add(unpacked_id(folder))
# Any other copy Chrome has loaded, in any profile.
for prefs in glob.glob(home + "/Library/Application Support/Google/Chrome/*/Secure Preferences") + glob.glob(home + "/Library/Application Support/Google/Chrome/*/Preferences"):
    try: settings = (json.load(open(prefs)).get("extensions") or {}).get("settings") or {}
    except (OSError, ValueError): continue
    for ext, entry in settings.items():
        where = str(entry.get("path") or "")
        name = str((entry.get("manifest") or {}).get("name") or "")
        if name == "Save to Gallery" or "save-to-gallery" in where or where.endswith("laniameda.gallery/extension"): ids.add(ext)
conf["extensions"] = sorted(ids)
conf.setdefault("port", 47615)
tokens = [p for p in (home + "/.config/claude-tokens/eallin.token", home + "/.config/claude-tokens/artist.token") if os.path.exists(p)]
if tokens and not conf.get("tokens"): conf["tokens"] = tokens
json.dump(conf, open(path, "w"), indent=1)
os.chmod(path, 0o600)
print("allowed extension copies:", len(ids), "| Claude sign-ins:", len(conf.get("tokens") or tokens))
PY

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$DIR/writer.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>StandardOutPath</key><string>$LOG</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
PORT="$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("port",47615))' "$DIR/config.json")"
for i in 1 2 3 4 5 6 7 8; do
  sleep 1
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/health" 2>/dev/null; then echo; echo "writer is up on 127.0.0.1:$PORT"; exit 0; fi
done
echo "writer did not answer; see $LOG"; exit 1
