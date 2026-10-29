import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import {
  taskClaimSchema, taskCommentSchema, taskCompleteSchema, taskCreateSchema, taskListSchema, taskRefSchema, taskReleaseSchema,
} from "@/lib/tasks-contract";
import { agentActor, bareTaskRef, linkRef, taskAge, taskRef } from "@/lib/tasks";

// The agent task queue: list the work waiting, claim a task, comment while
// working, complete it with a result. Michael reviews in /tasks.
const actions = ["list", "get", "create", "claim", "release", "complete", "comment"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  list: "gallery:read",
  get: "gallery:read",
  create: "gallery:write",
  claim: "gallery:write",
  release: "gallery:write",
  complete: "gallery:write",
  comment: "gallery:write",
};

const TASKS_URL = "https://gallery.laniameda.space/tasks";

const stripLink = <T extends { id: string }>(link: T) => ({ ...link, id: link.id.replace(/^(asset|story|stack|moodboard|character|collection|folder|doc):/, "") });

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const actor = agentActor(agent.label || agent.tokenPrefix);
    const now = Date.now();
    const row = <T extends { _id: string; worldFolderId?: string; links: { kind: string; id: string }[]; createdAt: number; worldName?: string }>(task: T) => ({
      id: taskRef(task._id),
      world: task.worldName ?? "studio",
      age: taskAge(task.createdAt, now),
      url: `${TASKS_URL}?task=${task._id}`,
      ...task,
      links: task.links.map((link) => ({ ...link, ref: linkRef(link as never) })),
    });
    const taskId = () => bareTaskRef(String(body.taskId ?? "")) as Id<"tasks">;

    if (action === "list") {
      const input = taskListSchema.parse(body);
      const tasks = await client.query(api.tasks.listTasks, {
        ownerUserId, world: input.world, status: input.status, assignee: input.assignee, source: input.source, limit: input.limit,
      });
      return NextResponse.json({
        count: tasks.length,
        tasks: tasks.map(row),
        next: "claim_task before working; comment_task for progress; complete_task with a result naming the asset:/story:/stack: ids produced, or blocked: true with a question for Michael.",
      });
    }
    if (action === "get") {
      taskRefSchema.parse(body);
      const result = await client.query(api.tasks.getTask, { ownerUserId, taskId: taskId() });
      return NextResponse.json({ task: row(result.task), links: result.links.map((link) => ({ ...link, ref: linkRef(link) })), events: result.events });
    }
    if (action === "create") {
      const input = taskCreateSchema.parse(body);
      const result = await client.mutation(api.tasks.createTask, {
        ownerUserId, world: input.world, title: input.title, brief: input.brief, priority: input.priority, createdBy: actor,
        assignee: input.assignee, links: input.links?.map(stripLink), dueAt: input.dueAt, ingestKey: input.ingestKey, session: input.session,
      });
      return NextResponse.json({ ok: true, created: result.created, task: row(result.task) });
    }
    if (action === "claim") {
      const input = taskClaimSchema.parse(body);
      const result = await client.mutation(api.tasks.claimTask, {
        ownerUserId, taskId: taskId(), claimedBy: input.assignee ?? actor, leaseMinutes: input.leaseMinutes,
      });
      return NextResponse.json({ ok: true, claimed: result.claimed, renewed: result.renewed, task: row(result.task) });
    }
    if (action === "release") {
      const input = taskReleaseSchema.parse(body);
      const task = await client.mutation(api.tasks.releaseTask, { ownerUserId, taskId: taskId(), actor, note: input.note });
      return NextResponse.json({ ok: true, task: row(task) });
    }
    if (action === "complete") {
      const input = taskCompleteSchema.parse(body);
      const task = await client.mutation(api.tasks.completeTask, {
        ownerUserId, taskId: taskId(), result: input.result, status: input.blocked ? "blocked" : "done",
        links: input.links?.map(stripLink), actor, session: input.session,
      });
      return NextResponse.json({ ok: true, task: row(task) });
    }
    const input = taskCommentSchema.parse(body);
    const result = await client.mutation(api.tasks.commentTask, { ownerUserId, taskId: taskId(), body: input.body, author: actor });
    return NextResponse.json({ ok: true, reopened: result.reopened, task: row(result.task) });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Task request failed.") }, { status: 400 });
  }
}
