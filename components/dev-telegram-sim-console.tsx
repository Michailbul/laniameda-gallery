"use client";

import { useMemo, useState } from "react";

type SimulateResponse = {
  ok: boolean;
  runId?: string;
  status?: string;
  duplicate?: boolean;
  requestId?: string;
  error?: string;
};

type RunStatusResponse = {
  ok: boolean;
  run?: {
    _id: string;
    status: string;
    source: string;
    runtime?: string;
    createdAt: number;
    updatedAt: number;
    lastError?: string;
  };
  events?: Array<{ type: string; payload?: Record<string, unknown> }>;
  error?: string;
};

const textAreaRows = 8;

export function DevTelegramSimConsole() {
  const [chatId, setChatId] = useState("278674008");
  const [threadId, setThreadId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [fromUserId, setFromUserId] = useState("278674008");
  const [fromDisplayName, setFromDisplayName] = useState("Local Dev User");
  const [chatType, setChatType] = useState("direct");
  const [text, setText] = useState("Summarize this and extract prompts: https://example.com");
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<SimulateResponse | null>(null);
  const [statusResponse, setStatusResponse] = useState<RunStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const statusUrl = useMemo(() => {
    if (!response?.runId) {
      return "";
    }
    return `/api/dev/telegram/simulate/runs/${response.runId}`;
  }, [response?.runId]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatusResponse(null);
    try {
      const formData = new FormData();
      formData.set("chatId", chatId);
      formData.set("threadId", threadId);
      formData.set("messageId", messageId);
      formData.set("fromUserId", fromUserId);
      formData.set("fromDisplayName", fromDisplayName);
      formData.set("chatType", chatType);
      formData.set("text", text);
      formData.set("links", links);
      for (const file of files) {
        formData.append("mediaFiles", file);
      }

      const result = await fetch("/api/dev/telegram/simulate", {
        method: "POST",
        body: formData,
      });
      const payload = (await result.json().catch(() => null)) as SimulateResponse | null;
      if (!result.ok) {
        setResponse({
          ok: false,
          error: payload?.error || `Request failed (${result.status})`,
          requestId: payload?.requestId,
        });
        return;
      }
      setResponse(payload || { ok: false, error: "Unexpected empty response." });
    } finally {
      setSubmitting(false);
    }
  };

  const pollStatus = async () => {
    if (!statusUrl) {
      return;
    }
    setStatusLoading(true);
    try {
      const result = await fetch(statusUrl, { method: "GET" });
      const payload = (await result.json().catch(() => null)) as RunStatusResponse | null;
      if (!result.ok) {
        setStatusResponse({ ok: false, error: payload?.error || `Failed (${result.status})` });
        return;
      }
      setStatusResponse(payload || { ok: false, error: "Unexpected empty response." });
    } finally {
      setStatusLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Dev Telegram Simulator</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Local Telegram-parity ingress for worker ingest runs without ngrok/bot webhook.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4 rounded-xl border border-neutral-200 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Chat ID
            <input
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Thread ID (optional)
            <input
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={threadId}
              onChange={(event) => setThreadId(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Message ID (optional, set to test idempotency)
            <input
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={messageId}
              onChange={(event) => setMessageId(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Chat Type
            <select
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={chatType}
              onChange={(event) => setChatType(event.target.value)}
            >
              <option value="direct">direct</option>
              <option value="group">group</option>
              <option value="supergroup">supergroup</option>
              <option value="channel">channel</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            From User ID (optional)
            <input
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={fromUserId}
              onChange={(event) => setFromUserId(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Display Name (optional)
            <input
              className="rounded-md border border-neutral-300 px-3 py-2"
              value={fromDisplayName}
              onChange={(event) => setFromDisplayName(event.target.value)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Message Text
          <textarea
            className="rounded-md border border-neutral-300 px-3 py-2"
            rows={textAreaRows}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type Telegram-like message text"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Extra Links (newline or comma separated)
          <textarea
            className="rounded-md border border-neutral-300 px-3 py-2"
            rows={3}
            value={links}
            onChange={(event) => setLinks(event.target.value)}
            placeholder="https://example.com"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Media Files (optional)
          <input
            className="rounded-md border border-neutral-300 px-3 py-2"
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files || []))}
          />
        </label>

        <button
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          type="submit"
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Submit Simulated Telegram Update"}
        </button>
      </form>

      {response && (
        <section className="mt-8 space-y-3 rounded-xl border border-neutral-200 p-6">
          <h2 className="text-lg font-semibold">Run Result</h2>
          <pre className="overflow-x-auto rounded-md bg-neutral-100 p-3 text-xs">
            {JSON.stringify(response, null, 2)}
          </pre>
          {response.runId && (
            <div className="flex flex-wrap items-center gap-3">
              <a className="text-sm underline" href={statusUrl} target="_blank" rel="noreferrer">
                Poll status endpoint
              </a>
              <button
                className="rounded-md border border-neutral-300 px-3 py-1 text-sm"
                onClick={pollStatus}
                disabled={statusLoading}
                type="button"
              >
                {statusLoading ? "Polling..." : "Refresh status"}
              </button>
            </div>
          )}
        </section>
      )}

      {statusResponse && (
        <section className="mt-4 space-y-2 rounded-xl border border-neutral-200 p-6">
          <h2 className="text-lg font-semibold">Run Status</h2>
          <pre className="overflow-x-auto rounded-md bg-neutral-100 p-3 text-xs">
            {JSON.stringify(statusResponse, null, 2)}
          </pre>
        </section>
      )}

      <section className="mt-8 rounded-xl border border-neutral-200 p-6 text-sm text-neutral-700">
        <h2 className="text-base font-semibold">Quick checks</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Run <code>bun run dev:sim</code>.</li>
          <li>Submit here and copy <code>runId</code>.</li>
          <li>Watch worker stdout for streamed/final dev_telegram replies.</li>
          <li>Verify Convex run events include ingest phases and completion.</li>
        </ol>
      </section>
    </main>
  );
}
