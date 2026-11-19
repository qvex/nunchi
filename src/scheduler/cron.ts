import cron from "node-cron";
import { config } from "../config.ts";
import { query } from "../db/client.ts";
import { notifyOwner } from "../discord/bot.ts";
import { runTasks, show, listTasks } from "../agents/tasks.ts";
import { formatJobs, runJobSearch } from "../jobs/search.ts";
import { getAgentConfig } from "../llm/registry.ts";
import { nextOccurrence, type Recurrence } from "../tasks/recurrence.ts";
import { formatLocal, inQuietHours, startOfLocalDay } from "../time.ts";
import { unmask } from "../llm/mask.ts";

const DAY = 86_400_000;

/** Every minute: send due reminders, unless it's quiet hours (they go out when quiet hours end). */
export async function sendDueReminders(now = new Date()) {
  if (inQuietHours(now)) return 0;
  const due = await query("SELECT * FROM tasks WHERE status='open' AND due_at <= $1 AND reminded_at IS NULL ORDER BY due_at", [now]);
  for (const t of due) {
    await notifyOwner(`⏰ Reminder: **${t.title}** (#${t.id}, due ${formatLocal(t.due_at)})`);
    if (t.recurrence !== "none") {
      const next = nextOccurrence(new Date(t.due_at), t.recurrence as Recurrence, now);
      await query("UPDATE tasks SET due_at=$2, reminded_at=NULL WHERE id=$1", [t.id, next]);
    } else {
      await query("UPDATE tasks SET reminded_at=$2 WHERE id=$1", [t.id, now]);
    }
  }
  return due.length;
}

/** Move unfinished one-off tasks from earlier days to the same time today. */
export async function rollOver(now = new Date()) {
  const sod = startOfLocalDay(now);
  const rows = await query("SELECT * FROM tasks WHERE status='open' AND recurrence='none' AND due_at < $1", [sod]);
  for (const t of rows) {
    const daysBehind = Math.ceil((sod.getTime() - new Date(t.due_at).getTime()) / DAY);
    await query("UPDATE tasks SET due_at = due_at + make_interval(days => $2), reminded_at = NULL WHERE id = $1", [t.id, daysBehind]);
  }
  return rows.length;
}

async function morningPlan() {
  const moved = await rollOver();
  if (!(await getAgentConfig("tasks")).enabled) return;
  const plan = await runTasks(
    "Write my plan for today: list today's tasks with list_tasks(today), then the most important open tasks without a due date, prioritised. Keep it short.",
  );
  await notifyOwner(`☀️ **Good morning.**${moved ? ` ${moved} unfinished task(s) rolled over to today.` : ""}\n\n${await unmask(plan)}`);
}

async function eveningReview() {
  const open = await listTasks("today");
  const body = open.length
    ? `Still open today:\n${open.map(show).join("\n")}\n\nWhat got done? Reply like **done 3, 5**. Anything left rolls over to tomorrow morning.`
    : "Nothing left open today. 🎉";
  await notifyOwner(`🌙 **Evening review**\n${body}`);
}

async function jobCheck(firstOfDay: boolean) {
  if (!(await getAgentConfig("jobs")).enabled) return;
  const r = await runJobSearch({ includeJsearch: firstOfDay });
  if (r.note) return console.log("[jobs]", r.note);
  if (r.sent.length) await notifyOwner(`💼 **${r.sent.length} new job match(es)**\n\n${formatJobs(r.sent)}`);
  else console.log(`[jobs] ${r.found} new listings, no matches`);
}

const safe = (name: string, fn: () => Promise<unknown>) => async () => {
  try { await fn(); } catch (e) { console.error(`[cron] ${name} failed:`, e); }
};

export function startScheduler() {
  const opts = { timezone: config.timezone };
  cron.schedule("* * * * *", safe("reminders", sendDueReminders), opts);
  cron.schedule(config.schedules.morningPlan, safe("morningPlan", morningPlan), opts);
  cron.schedule(config.schedules.eveningReview, safe("eveningReview", eveningReview), opts);
  config.schedules.jobChecks.forEach((expr, i) => cron.schedule(expr, safe("jobCheck", () => jobCheck(i === 0)), opts));
  console.log("[cron] scheduled (timezone", config.timezone + ")");
}

export const jobs = { morningPlan, eveningReview, jobCheck };
