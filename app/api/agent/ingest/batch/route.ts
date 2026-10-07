import { NextResponse } from "next/server";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { MAX_INGEST_BATCH, ingestForAgent, PartialAgentSaveError } from "@/lib/server/agent-ingest";

export const maxDuration = 300;

// Saves run a few at a time: each one is a Convex action that may embed and
// describe the piece, so firing 50 at once just queues them there instead.
const CONCURRENCY = 4;

export async function POST(request: Request) {
  try {
    const agent = await requireAgentAuth(request, "gallery:write");
    const data = (await request.json().catch(() => null)) as { items?: unknown } | null;
    const items = Array.isArray(data?.items) ? data.items : null;
    if (!items || items.length === 0) {
      return NextResponse.json({ error: "items must be a non-empty array." }, { status: 400 });
    }
    if (items.length > MAX_INGEST_BATCH) {
      return NextResponse.json(
        { error: `At most ${MAX_INGEST_BATCH} items per batch; split the rest into another call.` },
        { status: 400 },
      );
    }

    // One bad item never sinks the batch: each reports its own outcome.
    const results: Array<Record<string, unknown>> = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          results[index] = { index, ok: false, error: "Item must be an object." };
          continue;
        }
        try {
          const { result, collections } = await ingestForAgent(agent, item as Record<string, unknown>);
          results[index] = { index, ok: true, ...result, collections };
        } catch (error) {
          if (error instanceof PartialAgentSaveError) {
            results[index] = { index, ...error.toResult() };
            continue;
          }
          results[index] = {
            index,
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

    const saved = results.filter((entry) => entry.ok).length;
    const partial = results.filter((entry) => entry.partial).length;
    return NextResponse.json({ ok: saved === items.length, saved, partial, persisted: saved + partial, failed: items.length - saved, results });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
