import { POST as customizePost } from "@/app/api/agent/customize/route";
import { POST as galleryPost } from "@/app/api/agent/gallery/route";
import { POST as ingestPost } from "@/app/api/agent/ingest/route";
import { POST as ingestDeletePost } from "@/app/api/agent/ingest/delete/route";
import { POST as ingestUpdatePost } from "@/app/api/agent/ingest/update/route";

// The /api/agent/* handlers the hosted MCP calls in-process, keyed by path.
export const AGENT_ROUTES: Record<string, (request: Request) => Promise<Response>> = {
  "/api/agent/customize": customizePost,
  "/api/agent/gallery": galleryPost,
  "/api/agent/ingest": ingestPost,
  "/api/agent/ingest/delete": ingestDeletePost,
  "/api/agent/ingest/update": ingestUpdatePost,
};
