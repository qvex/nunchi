import { z } from "zod";
import { query } from "../db/client.ts";
import { defineTool } from "../tools/define.ts";
import { RECURRENCES, nextOccurrence, type Recurrence } from "../tasks/recurrence.ts";
import { formatLocal, startOfLocalDay } from "../time.ts";
import { runAgent, type Turn } from "./run.ts";

const DAY = 86_400_000;

function parseDue(due?: string | null): Date | null {
  if (!due) return null;
  const d = new Date(due);
  if (isNaN(d.getTime())) throw new Error(`Could not read due time "${due}"; use ISO 8601 with offset.`);
  return d;
}

export const show = (t: any) =>
  `#${t.id} ${t.title} | ${formatLocal(t.due_at)}${t.recurrence !== "none" ? ` | repeats ${t.recurrence}` : ""}${t.status === "done" ? " | done" : ""}`;

export async function listTasks(scope: "today" | "open" | "overdue" | "done_recently") {
  const sod = startOfLocalDay();
  const eod = new Date(sod.getTime() + DAY);
  const sql: Record<typeof scope, [string, unknown[]]> = {
    today: ["SELECT * FROM tasks WHERE status='open' AND due_at >= $1 AND due_at < $2 ORDER BY due_at", [sod, eod]],
    open: ["SELECT * FROM tasks WHERE status='open' ORDER BY due_at NULLS LAST, id", []],
    overdue: ["SELECT * FROM tasks WHERE status='open' AND due_at < now() ORDER BY due_at", []],
    done_recently: ["SELECT * FROM tasks WHERE status='done' AND completed_at > now() - interval '7 days' ORDER BY completed_at DESC", []],
  };
  return query(...sql[scope]);
}

export async function completeTask(id: number): Promise<string> {
  const [t] = await query("SELECT * FROM tasks WHERE id = $1", [id]);
  if (!t) return `No task #${id}.`;
  if (t.recurrence !== "none") {
    // Recurring: advance to the next occurrence and keep it open.
    const next = nextOccurrence(new Date(t.due_at ?? Date.now()), t.recurrence as Recurrence);
    await query("UPDATE tasks SET due_at = $2, reminded_at = NULL WHERE id = $1", [id, next]);
    return `Done for now. #${id} repeats next on ${formatLocal(next)}.`;
  }
  await query("UPDATE tasks SET status='done', completed_at=now() WHERE id = $1", [id]);
  return `Marked #${id} done.`;
}

export const taskTools = [
  defineTool({
    name: "add_task",
    description: "Create a task. `due` is ISO 8601 with offset (e.g. 2026-11-20T18:00:00+05:30) or omitted for no due time. A reminder is sent at the due time.",
    schema: z.object({
      title: z.string(),
      due: z.string().optional(),
      recurrence: z.enum(RECURRENCES).optional(),
    }),
    run: async ({ title, due, recurrence = "none" }) => {
      const dueAt = parseDue(due);
      if (recurrence !== "none" && !dueAt) throw new Error("Recurring tasks need a first due time.");
      const [t] = await query("INSERT INTO tasks (title, due_at, recurrence) VALUES ($1,$2,$3) RETURNING *", [title, dueAt, recurrence]);
      return `Added ${show(t)}`;
    },
  }),
  defineTool({
    name: "list_tasks",
    description: "List tasks. scope: today | open | overdue | done_recently.",
    schema: z.object({ scope: z.enum(["today", "open", "overdue", "done_recently"]) }),
    run: async ({ scope }) => {
      const rows = await listTasks(scope);
      return rows.length ? rows.map(show).join("\n") : "None.";
    },
  }),
  defineTool({
    name: "complete_task",
    description: "Mark one or more tasks done by id.",
    schema: z.object({ ids: z.array(z.number().int()) }),
    run: async ({ ids }) => (await Promise.all(ids.map(completeTask))).join("\n"),
  }),
  defineTool({
    name: "update_task",
    description: "Change a task's title, due time (ISO 8601 with offset) or recurrence.",
    schema: z.object({
      id: z.number().int(),
      title: z.string().optional(),
      due: z.string().optional(),
      recurrence: z.enum(RECURRENCES).optional(),
    }),
    run: async ({ id, title, due, recurrence }) => {
      const [t] = await query(
        `UPDATE tasks SET title = COALESCE($2, title), due_at = COALESCE($3, due_at), recurrence = COALESCE($4, recurrence),
           reminded_at = CASE WHEN $3::timestamptz IS NULL THEN reminded_at ELSE NULL END
         WHERE id = $1 RETURNING *`,
        [id, title ?? null, parseDue(due), recurrence ?? null],
      );
      return t ? `Updated ${show(t)}` : `No task #${id}.`;
    },
  }),
  defineTool({
    name: "delete_task",
    description: "Delete a task by id. Only when the user explicitly asks to delete/remove it.",
    schema: z.object({ id: z.number().int() }),
    run: async ({ id }) => ((await query("DELETE FROM tasks WHERE id = $1 RETURNING id", [id])).length ? `Deleted #${id}.` : `No task #${id}.`),
  }),
];

const SYSTEM = `You are the tasks and reminders agent of a personal assistant.
- Turn requests like "remind me to call mom Fri 6pm" into tasks with add_task. Reminders fire at the due time.
- If a request has no time but sounds time-bound ("tomorrow"), ask for the time unless the meaning is clear.
- When the user reports what they finished (e.g. "done 3, 5"), call complete_task.
- When asked for a plan, list the tasks and prioritise them; be concise.
- Always show task ids so the user can refer to them.`;

export const runTasks = (input: string, history?: Turn[]) => runAgent("tasks", { systemPrompt: SYSTEM, tools: taskTools, input, history });
