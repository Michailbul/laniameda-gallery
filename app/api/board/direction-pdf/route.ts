import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getServerConvexClient } from "@/lib/server/convex";
import { buildDirectionPdf } from "@/lib/server/direction-pdf";

// Image fetching + re-encoding for a full direction takes real time.
export const maxDuration = 60;

const pdfFileName = (name: string) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "direction"}-direction.pdf`;
};

/**
 * Packaged-PDF export for one direction of a shared board. Token-gated like
 * the rest of /api/board; images embedded, videos included as links.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";
  const folderId = searchParams.get("folderId")?.trim() ?? "";
  if (!token || !folderId) {
    return new Response("Missing token or folderId.", { status: 400 });
  }

  let payload;
  try {
    const client = getServerConvexClient();
    payload = await client.query(api.directionBoard.getBoardDirection, {
      token,
      folderId: folderId as Id<"folders">,
    });
  } catch {
    return new Response("Invalid request.", { status: 400 });
  }
  if (!payload) {
    return new Response("Not found.", { status: 404 });
  }

  const bytes = await buildDirectionPdf({
    projectName: payload.projectName,
    directionName: payload.direction.name,
    coverAssetId: payload.direction.coverAssetId ?? null,
    assets: payload.direction.assets,
  });

  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(
        payload.direction.name,
      )}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
