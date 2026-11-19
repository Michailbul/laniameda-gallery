import { NextResponse } from "next/server";
import { validateExtensionToken } from "@/lib/server/extension-auth";
import { EXPAND_SYSTEM_DEFAULT } from "@/lib/mj-expand";
import { DESCRIBE_BASE_RULES } from "@/lib/mj-describe";
import { QUICK_EDIT_SYSTEM_DEFAULT } from "@/lib/mj-quick-edit";
import { WRITER_RULES_LIMIT, writerModelList } from "@/lib/writer-models";

// The writer's own system prompts, as the gallery builds them today, and the
// models it can run on. The extension's MJ settings → Writer shows them, lets
// the art director edit each one (saved in the extension, sent with every
// call) and Reset brings these back. What is added after them on each call is
// listed in `adds`, so the panel can say so.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const TOOLS = [
  {
    key: "grow", label: "Grow", rules: EXPAND_SYSTEM_DEFAULT,
    adds: ["the Dear Annete cinematic addendum (Dear Annete worlds)", "the world's files: rules, learnings, cast, bible", "your world notes"],
  },
  {
    key: "describe", label: "Describe", rules: DESCRIBE_BASE_RULES,
    adds: ["your world notes"],
  },
  {
    key: "edit", label: "Quick edit", rules: QUICK_EDIT_SYSTEM_DEFAULT,
    adds: ["the Dear Annete cinematic addendum (Dear Annete worlds)", "the world's short brief", "your world notes"],
  },
] as const;

export async function GET(request: Request) {
  if (!validateExtensionToken(request)) {
    return NextResponse.json({ error: "Unauthorized extension request." }, { status: 401, headers: CORS_HEADERS });
  }
  return NextResponse.json(
    { ok: true, limit: WRITER_RULES_LIMIT, models: writerModelList(), tools: TOOLS },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
