import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { Sandbox } from "@daytonaio/sdk";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";

const shellEscape = (value: string) => {
  return `'${value.replace(/'/g, `'\\''`)}'`;
};

const buildShellCommand = ({
  command,
  args,
  cwd,
  env,
}: {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}) => {
  const commandParts = [command, ...args].map((part) => shellEscape(part));
  const envParts = Object.entries(env ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `${key}=${shellEscape(value as string)}`);
  const prefix = envParts.length > 0 ? `export ${envParts.join(" ")}; ` : "";
  const cd = cwd ? `cd ${shellEscape(cwd)}; ` : "";
  return `${prefix}${cd}exec ${commandParts.join(" ")}`;
};

const rewritePath = (value: string, localRoot: string, remoteRoot: string) => {
  if (value.startsWith(localRoot)) {
    return `${remoteRoot}${value.slice(localRoot.length)}`;
  }
  return value;
};

export class DaytonaSpawnedProcess extends EventEmitter implements SpawnedProcess {
  readonly stdin: Writable;
  readonly stdout: PassThrough;
  killed = false;
  exitCode: number | null = null;

  private sessionId?: string;
  private commandId?: string;
  private readonly ready: Promise<void>;
  private readonly sandbox: Sandbox;

  constructor({
    sandbox,
    options,
    localSdkRoot,
    remoteSdkRoot,
    sandboxNodeCommand,
  }: {
    sandbox: Sandbox;
    options: SpawnOptions;
    localSdkRoot: string;
    remoteSdkRoot: string;
    sandboxNodeCommand: string;
  }) {
    super();
    this.sandbox = sandbox;
    this.stdout = new PassThrough();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        void this.ready
          .then(async () => {
            if (!this.sessionId || !this.commandId) {
              throw new Error("Sandbox process not ready.");
            }
            await sandbox.process.sendSessionCommandInput(
              this.sessionId,
              this.commandId,
              chunk.toString("utf8"),
            );
          })
          .then(() => callback())
          .catch((error) => {
            callback(error instanceof Error ? error : new Error(String(error)));
          });
      },
      final: (callback) => {
        callback();
      },
    });

    this.ready = this.start({
      sandbox,
      options,
      localSdkRoot,
      remoteSdkRoot,
      sandboxNodeCommand,
    });
  }

  private async start({
    sandbox,
    options,
    localSdkRoot,
    remoteSdkRoot,
    sandboxNodeCommand,
  }: {
    sandbox: Sandbox;
    options: SpawnOptions;
    localSdkRoot: string;
    remoteSdkRoot: string;
    sandboxNodeCommand: string;
  }) {
    try {
      this.sessionId = `claude-sdk-${randomUUID()}`;
      await sandbox.process.createSession(this.sessionId);

      const rewrittenArgs = options.args.map((arg) => rewritePath(arg, localSdkRoot, remoteSdkRoot));
      const cwd = options.cwd ? rewritePath(options.cwd, localSdkRoot, remoteSdkRoot) : undefined;
      const shellCommand = buildShellCommand({
        command: sandboxNodeCommand,
        args: rewrittenArgs,
        cwd,
        env: options.env,
      });

      const execution = await sandbox.process.executeSessionCommand(this.sessionId, {
        command: shellCommand,
        runAsync: true,
      });
      this.commandId = execution.cmdId;

      await sandbox.process.getSessionCommandLogs(
        this.sessionId,
        this.commandId,
        (stdoutChunk) => {
          this.stdout.write(stdoutChunk);
        },
        () => {
          // Intentionally ignored. Agent SDK transport only consumes stdout.
        },
      );

      const command = await sandbox.process.getSessionCommand(this.sessionId, this.commandId);
      const code = typeof command.exitCode === "number" ? command.exitCode : 1;
      this.finish(code, null);
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      this.finish(1, null);
    } finally {
      await this.cleanup();
    }
  }

  private async cleanup() {
    if (this.sessionId) {
      await this.sandbox.process.deleteSession(this.sessionId).catch(() => {});
    }
  }

  private finish(code: number | null, signal: NodeJS.Signals | null) {
    if (this.exitCode !== null) {
      return;
    }
    this.exitCode = code;
    this.stdout.end();
    this.emit("exit", code, signal);
  }

  kill(_signal: NodeJS.Signals): boolean {
    this.killed = true;
    void this.ready.then(() => {
      void this.cleanup();
      this.finish(this.exitCode ?? 1, "SIGTERM");
    });
    return true;
  }
}
