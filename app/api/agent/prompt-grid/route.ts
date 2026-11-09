import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { AgentAuthError, requireAgentAuth, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { GALLERY_ORIGIN } from "@/lib/gallery-routes";
import {
  presetFromStyleSchema, presetListSchema, presetPerturbSchema, presetSaveSchema, presetToStyleSchema,
  runRefSchema, runSchema, setListSchema, setSaveSchema,
} from "@/lib/prompt-grid-contract";

// Prompt sets × style presets × seeds for agents. Presets are exact recipes
// as frozen codes; a run is one MJ Queue thread Michael sends himself, one job
// per click, screening first. Verdicts (keep/drop) are Michael's alone.

const actions = ["presets", "save_preset", "preset_from_style", "perturb", "preset_to_style", "sets", "save_set", "preview", "queue", "grid", "results"] as const;
const READS = new Set(["presets", "sets", "preview", "grid"]);
const scopeFor = (action: string): AgentTokenScope => (READS.has(action) ? "gallery:read" : "gallery:write");

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopeFor(action));
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const actor = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);
    const tag = <T extends { id: string }>(prefix: string, row: T) => ({ ...row, id: `${prefix}:${row.id}` });

    switch (action) {
      case "presets": {
        const input = presetListSchema.parse(body);
        const rows = await client.query(api.promptGrid.listPresets, { ownerUserId, ...input });
        return NextResponse.json({ count: rows.length, presets: rows.map((row) => tag("preset", row)) });
      }
      case "save_preset": {
        const input = presetSaveSchema.parse(body);
        const result = await client.mutation(api.promptGrid.savePreset, { ownerUserId, ...input, actor });
        return NextResponse.json({ ...result, presetId: `preset:${result.presetId}` });
      }
      case "preset_from_style": {
        const input = presetFromStyleSchema.parse(body);
        const result = await client.mutation(api.promptGrid.presetFromStyle, { ownerUserId, ...input, actor });
        return NextResponse.json({ ...result, presetId: `preset:${result.presetId}` });
      }
      case "perturb": {
        const input = presetPerturbSchema.parse(body);
        const rows = await client.mutation(api.promptGrid.perturbPreset, { ownerUserId, ...input, actor });
        return NextResponse.json({ presets: rows.map((row) => ({ ...row, presetId: `preset:${row.presetId}` })) });
      }
      case "preset_to_style": {
        const input = presetToStyleSchema.parse(body);
        const recipe = await client.query(api.promptGrid.presetAsRecipe, { ownerUserId, preset: input.preset });
        const style = input.style ?? (recipe.styleId ? `style:${recipe.styleId}` : undefined);
        if (style) {
          const current = await client.query(api.worldStyles.getStyle, { ownerUserId, style: style.replace(/^style:/, ""), world: input.world });
          const existing = current.recipes.map((row) => ({
            name: row.name, moodboardIds: row.moodboards.map((m) => m.id), profileIds: row.profiles.map((p) => p.id),
            unknownCodes: row.unknownCodes, parameters: row.parameters, template: row.template, frames: row.frames, note: row.note,
          }));
          const result = await client.mutation(api.worldStyles.saveStyle, { ownerUserId, world: input.world, style: current.id, recipes: [...existing, recipe.recipe].slice(0, 8), actor, session: input.session });
          return NextResponse.json({ ok: true, style: `style:${result.styleId}`, added: "recipe", note: "One style is one recipe: a second recipe on a style is only right when it makes the same look. Otherwise save it as its own style (leave style out)." });
        }
        const result = await client.mutation(api.worldStyles.saveStyle, { ownerUserId, world: input.world, name: recipe.name, recipes: [recipe.recipe], actor, session: input.session });
        return NextResponse.json({ ok: true, style: `style:${result.styleId}`, created: result.created });
      }
      case "sets": {
        const input = setListSchema.parse(body);
        const rows = await client.query(api.promptGrid.listPromptSets, { ownerUserId, ...input });
        return NextResponse.json({ count: rows.length, sets: rows.map((row) => ({ ...tag("set", row), prompts: row.prompts.map((p) => tag("lp", p)) })) });
      }
      case "save_set": {
        const input = setSaveSchema.parse(body);
        const result = await client.mutation(api.promptGrid.savePromptSet, { ownerUserId, ...input, actor });
        return NextResponse.json({ ...result, setId: `set:${result.setId}` });
      }
      case "preview": {
        const input = runSchema.parse(body);
        const { thread: _thread, ...rest } = input;
        void _thread;
        return NextResponse.json(await client.query(api.promptGrid.previewRun, { ownerUserId, ...rest }));
      }
      case "queue": {
        const input = runSchema.parse(body);
        const result = await client.mutation(api.promptGrid.queueRun, { ownerUserId, ...input, createdBy: actor });
        return NextResponse.json({
          ...result, runId: `run:${result.runId}`,
          url: `${GALLERY_ORIGIN}/w/${result.worldKey}/queue?thread=${result.threadId}`,
          gridUrl: `${GALLERY_ORIGIN}/w/${result.worldKey}/grid?run=${result.runId}`,
          next: `Queued for Michael (${result.pacing.label} at the account caps). He sends each job himself. After he saves frames, call file_run_results.`,
        });
      }
      case "grid": {
        const input = runRefSchema.parse(body);
        return NextResponse.json(await client.query(api.promptGrid.getRunGrid, { ownerUserId, run: input.run }));
      }
      case "results": {
        const input = runRefSchema.parse(body);
        return NextResponse.json(await client.mutation(api.promptGrid.fileRunResults, { ownerUserId, run: input.run, session: input.session }));
      }
    }
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Could not do that.") }, { status: 400 });
  }
}
