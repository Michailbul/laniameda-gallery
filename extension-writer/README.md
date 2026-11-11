# laniameda writer bridge

Runs the Save to Gallery extension's writer on your own Mac with Claude Code, so
Grow, quick edit and Make it ours need no provider credit.

## Install (once per Mac)

    extension-writer/install.sh

It copies `writer.py` to `~/.config/laniameda/writer/`, writes `config.json`
there (port, the extension copies allowed to call it, the Claude sign-ins) and
starts the LaunchAgent `com.laniameda.writer`. Run it again after an update of
this folder, or after loading the extension in a new Chrome profile. Remove with
`extension-writer/install.sh --remove`.

Needs: `~/.local/bin/claude` (Claude Code) and a long-lived sign-in from
`claude setup-token` in `~/.config/claude-tokens/eallin.token` or `artist.token`.

## How a call runs

1. The extension asks the gallery for the writer's messages (`local.stage = "messages"`).
2. It posts them to `http://127.0.0.1:47615/v1/write` with the model, `haiku` or `sonnet`.
3. The bridge runs `claude -p --model claude-haiku-5-5` (or `claude-sonnet-5-5`)
   with no tools, no MCP servers, an empty settings folder and the pictures inline.
   A picture and a prompt take about three seconds.
4. The extension hands the raw answer back to the gallery (`local.stage = "finish"`),
   which reads it exactly as it reads a provider's answer.

## What it will not do

- Answer a web page, another extension or another machine: it listens on
  127.0.0.1 only and checks the `Origin` and `Host` of every request.
- Use tools, read files or run commands: Claude is started with `--tools ""`.
- Download from Midjourney: pictures arrive as data, and links are followed only
  to the gallery's own storage.

Log: `~/Library/Logs/laniameda-writer.log` (time, model, account, duration; no prompt text).
