import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

export const runtime = "nodejs";

const SKILL_FILES: Array<{ entry: string; source: string[] }> = [
  {
    entry: "README.md",
    source: ["content", "skills", "README.md"],
  },
  {
    entry: "laniameda-gallery-ingest/SKILL.md",
    source: ["content", "skills", "laniameda-gallery-ingest", "SKILL.md"],
  },
  {
    entry: "laniameda-gallery-query/SKILL.md",
    source: ["content", "skills", "laniameda-gallery-query", "SKILL.md"],
  },
];

export async function GET() {
  try {
    const zip = new JSZip();
    for (const { entry, source } of SKILL_FILES) {
      const absolute = path.join(process.cwd(), ...source);
      const contents = await fs.readFile(absolute, "utf-8");
      zip.file(entry, contents);
    }
    const blob = await zip.generateAsync({ type: "uint8array" });

    return new NextResponse(blob as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="laniameda-gallery-skill.zip"`,
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to bundle skill.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
