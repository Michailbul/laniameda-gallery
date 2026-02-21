import { createServer } from "node:http";
import { URL } from "node:url";
import { assertWorkerConfig, workerConfig } from "./config";
import { dispatchRun, cancelDispatchedRun } from "./orchestrator";
import { verifyWorkerSignature } from "../lib/worker-signature";

const readBody = async (request: Request) => {
  const text = await request.text();
  return text;
};

const verifySignedRequest = async (request: Request, body: string) => {
  const signature = request.headers.get("x-agent-signature");
  const timestamp = request.headers.get("x-agent-timestamp");
  if (!signature || !timestamp) {
    return false;
  }
  return verifyWorkerSignature({
    secret: workerConfig.sharedSecret,
    body,
    signature,
    timestamp,
  });
};

const parseJson = <T>(input: string): T | null => {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
};

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/health") {
    return Response.json({
      ok: true,
      service: "agent-worker",
      workerId: workerConfig.workerId,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  }

  if (request.method === "POST" && pathname === "/v1/runs/dispatch") {
    const body = await readBody(request);
    const signed = await verifySignedRequest(request, body);
    if (!signed) {
      return Response.json({ error: "Invalid signature." }, { status: 401 });
    }

    const payload = parseJson<{ runId?: string }>(body);
    if (!payload) {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (!payload.runId || typeof payload.runId !== "string") {
      return Response.json({ error: "runId is required." }, { status: 400 });
    }

    const result = await dispatchRun(payload.runId);
    if (!result.accepted) {
      return Response.json({ ok: false, status: result.status }, { status: 409 });
    }

    return Response.json({ ok: true, status: result.status }, { status: 202 });
  }

  if (request.method === "POST" && /^\/v1\/runs\/[^/]+\/cancel$/.test(pathname)) {
    const body = await readBody(request);
    const signed = await verifySignedRequest(request, body);
    if (!signed) {
      return Response.json({ error: "Invalid signature." }, { status: 401 });
    }

    const runId = pathname.split("/")[3];
    const payload = parseJson<{ reason?: string }>(body || "{}");
    if (!payload) {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const reason = typeof payload.reason === "string" ? payload.reason : "Canceled by user.";
    await cancelDispatchedRun({ runId, reason });
    return Response.json({ ok: true, runId, status: "canceled" });
  }

  return Response.json({ error: "Not found." }, { status: 404 });
};

const start = () => {
  assertWorkerConfig();
  const server = createServer((incoming, outgoing) => {
    const origin = `http://${incoming.headers.host || "localhost"}`;
    const request = new Request(`${origin}${incoming.url || "/"}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      body:
        incoming.method === "GET" || incoming.method === "HEAD"
          ? undefined
          : (incoming as unknown as BodyInit),
    } as RequestInit & { duplex?: "half" });

    handler(request)
      .then(async (response) => {
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => {
          outgoing.setHeader(key, value);
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        outgoing.end(buffer);
      })
      .catch((error) => {
        console.error("Worker handler error:", error);
        outgoing.statusCode = 500;
        outgoing.setHeader("content-type", "application/json");
        outgoing.end(JSON.stringify({ error: "Internal server error." }));
      });
  });

  server.listen(workerConfig.port, () => {
    console.log(
      `agent-worker listening on port ${workerConfig.port} (workerId=${workerConfig.workerId})`,
    );
  });
};

start();
