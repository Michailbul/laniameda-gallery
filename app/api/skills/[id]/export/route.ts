import { NextResponse } from "next/server";
import JSZip from "jszip";
import { api } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveSkillForOwner } from "@/lib/server/agent-skills";

const slugify = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill";

type SkillStep = {
  stepLabel?: string;
  promptText: string;
  promptSections?: { finalPrompt: string; negativePrompt?: string; generationNotes?: string };
  promptType?: string;
  modelName?: string;
  tagNames: string[];
};

type Skill = {
  title: string;
  description?: string;
  agentInstructions?: string;
  body?: string;
  pillar?: string;
  tagNames: string[];
  stepCount: number;
  steps: SkillStep[];
};

const buildSkillMarkdown = (skill: Skill): string => {
  const name = slugify(skill.title);
  const description =
    skill.description?.replace(/\s+/g, " ").trim() ||
    `Reproduce the "${skill.title}" skill.`;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${name}`);
  lines.push(`description: >-`);
  lines.push(`  ${description}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${skill.title}`);
  lines.push("");
  if (skill.description) {
    lines.push(skill.description.trim());
    lines.push("");
  }
  if (skill.body) {
    lines.push(skill.body.trim());
    lines.push("");
  }
  if (skill.agentInstructions) {
    lines.push("## How to run this skill");
    lines.push("");
    lines.push(skill.agentInstructions.trim());
    lines.push("");
  }
  lines.push("## Steps");
  lines.push("");
  skill.steps.forEach((step, index) => {
    const label = step.stepLabel?.trim() || `Step ${index + 1}`;
    lines.push(`### ${index + 1}. ${label}`);
    lines.push("");
    if (step.modelName) {
      lines.push(`- **Model:** ${step.modelName}`);
    }
    if (step.promptType) {
      lines.push(`- **Type:** ${step.promptType}`);
    }
    lines.push("");
    lines.push("**Prompt:**");
    lines.push("");
    lines.push("```");
    lines.push((step.promptSections?.finalPrompt || step.promptText).trim());
    lines.push("```");
    lines.push("");
    if (step.promptSections?.negativePrompt) {
      lines.push("**Negative prompt:**");
      lines.push("");
      lines.push("```");
      lines.push(step.promptSections.negativePrompt.trim());
      lines.push("```");
      lines.push("");
    }
    if (step.promptSections?.generationNotes) {
      lines.push(`**Notes:** ${step.promptSections.generationNotes.trim()}`);
      lines.push("");
    }
  });
  return lines.join("\n");
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    const { id } = await context.params;
    if (!id?.trim()) {
      return NextResponse.json({ error: "Skill id is required." }, { status: 400 });
    }

    const client = getServerConvexClient(user.ownerUserId);
    const skillId = await resolveSkillForOwner(client, user.ownerUserId, id);
    if (!skillId) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    const skill = (await client.query(api.skills.getSkill, {
      id: skillId,
      ownerUserId: user.ownerUserId,
    })) as Skill | null;

    if (!skill) {
      return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    }

    const slug = slugify(skill.title);
    const zip = new JSZip();
    zip.folder(slug)!.file("SKILL.md", buildSkillMarkdown(skill));
    const blob = await zip.generateAsync({ type: "uint8array" });

    return new NextResponse(blob as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}-skill.zip"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to export skill.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
