#!/usr/bin/python3
"""laniameda writer bridge: runs the extension's writer on this Mac with `claude -p`.

The Save to Gallery extension asks the gallery for the writer's messages, posts
them here, and hands the raw answer back to the gallery. This server only
listens on 127.0.0.1, only answers the extension (by its chrome-extension://
origin) and local tools, and runs Claude with no tools at all: one question,
one answer.

  GET  /health    -> {"ok": true, "models": ["haiku", "sonnet", "opus", "fable"], ...}
  POST /v1/write  {"messages": [...], "model": "haiku"|"sonnet"|"opus"|"fable", "maxTokens": 1500}
                  -> {"ok": true, "text": "...", "model": "haiku", "ms": 2700}

Config: ~/.config/laniameda/writer/config.json (written by install.sh).
Python 3.9, standard library only.

Accounts (1.4.0, 22 Nov 2026): the sign-ins are tried in order. An account
Claude refuses (sign-in disabled, key refused) is left out for six hours, one at
its usage limit until the limit resets, so a dead account costs nothing after
its first refusal. A run counts as hung when Claude sends nothing for
`idleSeconds` (it streams while it thinks and writes), and every request stays
inside a budget shorter than the extension's own wait, so a slow account hands
over to the next one instead of running the extension out of time.
"""
import base64, json, os, queue, re, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.5.0"
HOME = os.path.expanduser("~")
CONF_DIR = os.path.join(HOME, ".config", "laniameda", "writer")
MODELS = {"haiku": "claude-haiku-5-5", "sonnet": "claude-sonnet-5-5", "opus": "claude-opus-5-5", "fable": "claude-fable-5-2"}
DEFAULTS = {
    "port": 47615,
    "claude": os.path.join(HOME, ".local", "bin", "claude"),
    # Long-lived Claude sign-ins, tried in this order (a limited account falls through to the next).
    "tokens": [os.path.join(HOME, ".config", "claude-tokens", name + ".token") for name in ("eallin", "bul", "artist")],
    # chrome-extension ids allowed to call: the store copy, plus unpacked copies found by install.sh.
    "extensions": ["nlhmjpghlanlanpapgigmacjbnjoancb"],
    # Picture links the bridge may download itself. Midjourney's CDN is never fetched here: the extension sends the bytes.
    "imageHosts": ["pub-ad6ed85f12d147539181afa324bead00.r2.dev", "gallery.laniameda.space"],
    # One account's longest run, and the longest silence (no stream event) before a run counts as hung.
    "timeoutSeconds": 90,
    "idleSeconds": 45,
    # How hard the model thinks before it writes. Low keeps a set of prompts
    # under ten seconds even with a whole world bible in the brief.
    "effort": "low",
}
# Room for the model's own thinking on top of the answer's length. Without it
# a long brief (a world's bible) uses the whole budget before the answer is
# written, and the run is cut and retried.
THINKING_ROOM = 3000
MAX_OUTPUT = 12000
EFFORTS = ("low", "medium", "high")
MAX_BODY = 12_000_000
MAX_IMAGE = 5_000_000
RUNNING = threading.Semaphore(2)
# The whole request, every account included, ends before the extension stops
# waiting (background.js: 120 s for Haiku, 200 s for the others).
BUDGET = {"haiku": 105, "sonnet": 185, "opus": 185, "fable": 185}
# Accounts Claude refused: path -> (until, reason). Kept while the server runs.
BENCHED = {}
BENCH_LOCK = threading.Lock()
REFUSED = re.compile(r"disabled Claude subscription|organization has disabled|invalid.{0,20}(token|api key|x-api-key)|authentication_error|OAuth token (has expired|revoked)|\b401\b", re.I)
LIMITED = re.compile(r"usage_limit_reached|hit your (weekly|daily|session)? ?limit|rate_limit_error|limit · resets|out of (extra )?usage", re.I)


def bench(path, reason, seconds):
    with BENCH_LOCK:
        BENCHED[path] = (time.time() + seconds, reason)
    log("account %s left out for %s min: %s" % (os.path.basename(path), int(seconds // 60), reason[:120].replace("\n", " ")))


def benched(path):
    with BENCH_LOCK:
        entry = BENCHED.get(path)
        if entry and entry[0] <= time.time():
            BENCHED.pop(path, None)
            entry = None
    return entry


def bench_for(text):
    """How long to leave an account out after this answer: refused 6 h, limited 1 h, otherwise not at all."""
    if REFUSED.search(text or ""):
        return 6 * 3600
    if LIMITED.search(text or ""):
        return 3600
    return 0

# Every Midjourney job is --v 8.2 (Michael, 15 Nov 2026: "never use mj v8.1, do
# not let it happen"; V7 and older since 11 Nov). The rule rides on every system
# prompt, and an answer that still pins an older version is fixed before it
# leaves this Mac. Twin of lib/mj-version.ts in the gallery.
MJ_VERSION = "8.2"
VERSION_RULE = ("Midjourney version: every job is --v 8.2. Never write --v 8.1, --version 8.1, --v 7 or any older "
                "version; where the text pins one, write --v 8.2 instead. Leaving --v out is also fine: 8.2 is the default.")
RETIRED_VERSION = re.compile(r"(^|\s)(?:--|[–—])(?:v|version)(?:\s+|(?=\d))(\d+(?:\.\d+)?)(?=\s|$)", re.I)


def enforce_version(text):
    def fix(match):
        try:
            retired = float(match.group(2)) < float(MJ_VERSION)
        except ValueError:
            retired = False
        return match.group(1) + "--v " + MJ_VERSION if retired else match.group(0)
    return RETIRED_VERSION.sub(fix, text)


def config():
    conf = dict(DEFAULTS)
    try:
        with open(os.path.join(CONF_DIR, "config.json")) as handle:
            conf.update(json.load(handle))
    except (OSError, ValueError):
        pass
    return conf


def log(line):
    sys.stderr.write(time.strftime("%F %T ") + line + "\n")
    sys.stderr.flush()


def image_block(url, hosts):
    """A data URL or an allowed https link as an Anthropic image block."""
    match = re.match(r"^data:(image/(?:png|jpe?g|webp|gif));base64,(.+)$", url, re.S | re.I)
    if match:
        media, data = match.group(1).lower().replace("image/jpg", "image/jpeg"), re.sub(r"\s+", "", match.group(2))
        if len(data) * 3 // 4 > MAX_IMAGE:
            raise ValueError("The picture is too large.")
        return {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}}
    host = re.match(r"^https://([^/:?#]+)", url)
    if not host or host.group(1).lower() not in hosts:
        raise ValueError("The local writer only reads pictures sent as data, or links to the gallery.")
    request = urllib.request.Request(url, headers={"user-agent": "laniameda-writer/" + VERSION})
    with urllib.request.urlopen(request, timeout=20) as response:
        media = (response.headers.get("content-type") or "image/jpeg").split(";")[0].strip().lower()
        raw = response.read(MAX_IMAGE + 1)
    if len(raw) > MAX_IMAGE or not media.startswith("image/"):
        raise ValueError("That link is not a picture the writer can read.")
    return {"type": "image", "source": {"type": "base64", "media_type": media, "data": base64.b64encode(raw).decode()}}


def to_claude(messages, hosts):
    """OpenAI-style chat messages -> (system text, content blocks of one user turn)."""
    system, blocks = [], []
    for message in messages:
        role, content = message.get("role"), message.get("content")
        parts = [{"type": "text", "text": content}] if isinstance(content, str) else (content or [])
        for part in parts:
            if part.get("type") == "text" and str(part.get("text") or "").strip():
                (system if role == "system" else blocks).append(str(part["text"]) if role == "system" else {"type": "text", "text": str(part["text"])})
            elif part.get("type") == "image_url" and role != "system":
                blocks.append(image_block(str((part.get("image_url") or {}).get("url") or ""), hosts))
    if not any(block.get("type") == "text" for block in blocks):
        raise ValueError("There is nothing to ask.")
    # Pictures first: the model reads them before the question.
    blocks.sort(key=lambda block: 0 if block["type"] == "image" else 1)
    return "\n\n".join(system), blocks


def run_once(args, turn, env, cwd, idle, deadline):
    """One `claude -p` run, read as it streams. Returns (result event or None, stderr tail, why it stopped)."""
    proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, cwd=cwd)
    lines = queue.Queue()
    errors = []

    def pump(stream, sink):
        try:
            for line in stream:
                sink(line)
        except (OSError, ValueError):
            pass
        finally:
            if sink == lines.put:
                lines.put(None)

    threading.Thread(target=pump, args=(proc.stdout, lines.put), daemon=True).start()
    threading.Thread(target=pump, args=(proc.stderr, errors.append), daemon=True).start()
    try:
        proc.stdin.write(turn)
        proc.stdin.close()
    except OSError:
        pass
    result, stop = None, ""
    while True:
        left = deadline - time.time()
        if left <= 0:
            stop = "it took too long"
            break
        try:
            line = lines.get(timeout=min(idle, left))
        except queue.Empty:
            stop = "it took too long" if time.time() >= deadline else "Claude sent nothing for %s s" % int(idle)
            break
        if line is None:
            break
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") == "result":
            result = event
    if proc.poll() is None:
        proc.kill()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    return result, "".join(errors)[-300:].strip(), stop


def run_claude(conf, system, blocks, model, max_tokens, purpose=None):
    turn = json.dumps({"type": "user", "message": {"role": "user", "content": blocks}}) + "\n"
    # Partial messages keep events coming while Claude thinks and writes: silence means a hang.
    args = [conf["claude"], "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--model", MODELS[model], "--tools", "", "--strict-mcp-config", "--no-session-persistence",
            "--disable-slash-commands", "--setting-sources", "",
            "--effort", conf["effort"] if conf.get("effort") in EFFORTS else "low",
            "--system-prompt", (system or "You are a careful writing assistant. Answer with the text asked for and nothing else.") + ("\n\n" + VERSION_RULE if purpose != "image-edit" else "")]
    home = os.path.join(CONF_DIR, "claude-home")
    cwd = os.path.join(CONF_DIR, "cwd")
    os.makedirs(home, exist_ok=True); os.makedirs(cwd, exist_ok=True)
    deadline = time.time() + BUDGET.get(model, 105)
    idle = float(conf.get("idleSeconds") or 45)
    last = "No Claude sign-in was found on this Mac."
    tried = 0
    for path in conf["tokens"]:
        name = os.path.basename(path).replace(".token", "")
        out = benched(path)
        if out:
            last = "Every Claude sign-in on this Mac is out for now (%s: %s)." % (name, out[1][:120])
            continue
        try:
            token = open(path).read().strip()
        except OSError:
            continue
        if not token:
            continue
        if time.time() >= deadline - 5:
            last = "Claude took too long to answer."
            break
        tried += 1
        env = {key: value for key, value in os.environ.items() if not key.startswith(("ANTHROPIC_", "CLAUDE"))}
        env.update({"CLAUDE_CODE_OAUTH_TOKEN": token, "CLAUDE_CONFIG_DIR": home, "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(max(256, min(MAX_OUTPUT, int(max_tokens) + THINKING_ROOM)))})
        result, stderr, stop = run_once(args, turn, env, cwd, idle, min(deadline, time.time() + float(conf["timeoutSeconds"])))
        text = str((result or {}).get("result") or "").strip()
        # A cut answer comes back as text that ends in an API error line: that is a failure, not a result.
        if result and result.get("subtype") == "success" and not result.get("is_error") and text and "API Error:" not in text:
            return (str(result["result"]) if purpose == "image-edit" else enforce_version(str(result["result"]))), name
        if stop and not result:
            last = "Claude took too long to answer." if stop == "it took too long" else stop + "."
            log("account %s failed: %s" % (os.path.basename(path), stop))
            continue
        last = str(text or (result or {}).get("api_error") or stderr or "Claude returned nothing.")
        log("account %s failed: %s" % (os.path.basename(path), last[:160].replace("\n", " ")))
        seconds = bench_for(" ".join([last, str((result or {}).get("api_error") or ""), str((result or {}).get("api_error_type") or "")]))
        if seconds:
            bench(path, last, seconds)
    if not tried and BENCHED:
        log("no account to try: %s" % last[:160])
    raise RuntimeError(last[:300])


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # A caller that hung up is not an error worth a traceback.
        kind = sys.exc_info()[0]
        if kind and issubclass(kind, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    server_version = "laniameda-writer/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def allowed(self, conf):
        """Only this machine's own callers: the right Host, and either no Origin (a local tool) or our extension's."""
        host = (self.headers.get("host") or "").split(":")[0].lower()
        if host not in ("127.0.0.1", "localhost"):
            return False
        origin = self.headers.get("origin")
        if not origin:
            # A page cannot send JSON or custom headers across origins without an Origin header.
            return self.command == "GET" or (self.headers.get("content-type") or "").startswith("application/json")
        return origin in ["chrome-extension://" + ext for ext in conf["extensions"]]

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        origin = self.headers.get("origin")
        if origin and origin.startswith("chrome-extension://"):
            self.send_header("access-control-allow-origin", origin)
            self.send_header("vary", "origin")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # The extension stopped waiting: nothing to answer.
            log("the caller left before the answer (%s)" % self.path)

    def do_OPTIONS(self):
        conf = config()
        if not self.allowed(conf) and not (self.headers.get("origin") or "").startswith("chrome-extension://"):
            return self.reply(403, {"ok": False, "error": "Not allowed."})
        self.send_response(204)
        origin = self.headers.get("origin") or ""
        if origin in ["chrome-extension://" + ext for ext in conf["extensions"]]:
            self.send_header("access-control-allow-origin", origin)
            self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
            self.send_header("access-control-allow-headers", "content-type")
        self.send_header("content-length", "0")
        self.end_headers()

    def do_GET(self):
        conf = config()
        if not self.allowed(conf):
            return self.reply(403, {"ok": False, "error": "Not allowed."})
        if self.path.split("?")[0] != "/health":
            return self.reply(404, {"ok": False, "error": "Not found."})
        signed_in = [path for path in conf["tokens"] if os.path.exists(path)]
        ready = [path for path in signed_in if not benched(path)]
        note = None if ready else ("No Claude sign-in found." if not signed_in else "Every Claude sign-in on this Mac is out for now.")
        out = {os.path.basename(path).replace(".token", ""): benched(path)[1][:120] for path in signed_in if benched(path)}
        self.reply(200, {"ok": bool(signed_in) and os.path.exists(conf["claude"]), "name": "laniameda-writer", "version": VERSION, "models": list(MODELS),
                         "accounts": len(ready), "out": out, "note": note})

    def do_POST(self):
        conf = config()
        if not self.allowed(conf):
            return self.reply(403, {"ok": False, "error": "Not allowed."})
        if self.path.split("?")[0] != "/v1/write":
            return self.reply(404, {"ok": False, "error": "Not found."})
        try:
            length = int(self.headers.get("content-length") or 0)
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {"ok": False, "error": "The request is too large."})
            body = json.loads(self.rfile.read(length))
            model = body.get("model") if body.get("model") in MODELS else "haiku"
            system, blocks = to_claude(body.get("messages") or [], conf["imageHosts"])
        except (ValueError, TypeError, OSError) as error:
            return self.reply(400, {"ok": False, "error": str(error) or "Bad request."})
        started = time.time()
        if not RUNNING.acquire(timeout=30):
            return self.reply(429, {"ok": False, "error": "The local writer is busy. Try again."})
        try:
            text, account = run_claude(conf, system, blocks, model, body.get("maxTokens") or 1500, body.get("purpose"))
        except RuntimeError as error:
            log("failed %s: %s" % (model, str(error)[:200].replace("\n", " ")))
            return self.reply(502, {"ok": False, "error": str(error)})
        finally:
            RUNNING.release()
        ms = int((time.time() - started) * 1000)
        log("wrote %s chars with %s (%s) in %s ms" % (len(text), model, account, ms))
        self.reply(200, {"ok": True, "text": text, "model": model, "ms": ms})


if __name__ == "__main__":
    port = int(config()["port"])
    server = Server(("127.0.0.1", port), Handler)
    log("laniameda writer %s listening on 127.0.0.1:%s" % (VERSION, port))
    server.serve_forever()
