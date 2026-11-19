// Needs Postgres running: npm run db
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
process.env.OWNER_NAMES = "Asha Verma";
// Separate database so tests never touch real data.
const base = "postgres://assistant:assistant@localhost:5433";
process.env.DATABASE_URL = `${base}/assistant_test`;
{
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: `${base}/assistant` });
  await c.connect();
  await c.query("CREATE DATABASE assistant_test").catch(() => {});
  await c.end();
}
const { migrate, pool, query } = await import("../src/db/client.ts");
const { mask, unmask, unmaskDeep } = await import("../src/llm/mask.ts");
const { taskTools, completeTask } = await import("../src/agents/tasks.ts");
const { rollOver } = await import("../src/scheduler/cron.ts");

const tool = (name: string) => taskTools.find((t) => t.name === name) as any;

before(async () => {
  await migrate();
  await query("TRUNCATE tasks, pii_map RESTART IDENTITY");
});
after(() => pool.end());

test("masking hides emails, phones and names, keeps dates and times", async () => {
  const raw = "Email asha.verma@example.com or call +91 98765 43210 / 98765-43210. Asha Verma meets at 2026-11-20T18:00:00+05:30, room 1234567890ab.";
  const m = await mask(raw);
  assert.doesNotMatch(m, /example\.com|98765|Asha/);
  assert.match(m, /2026-11-20T18:00:00\+05:30/);
  assert.equal(await unmask(m), raw);
  assert.deepEqual(await unmaskDeep({ a: [m] }), { a: [raw] });
  assert.equal(await mask(m), m, "masking is idempotent");
});

test("task tools: add, list, complete (one-off and recurring)", async () => {
  const added = await tool("add_task").invoke({ title: "Call mom", due: "2099-01-02T18:00:00+05:30" });
  assert.match(String(added), /Added #1 Call mom/);
  const rec = await tool("add_task").invoke({ title: "Stretch", due: "2026-11-01T07:30:00+05:30", recurrence: "daily" });
  assert.match(String(rec), /repeats daily/);
  assert.match(String(await tool("list_tasks").invoke({ scope: "open" })), /#2 Stretch[\s\S]*#1 Call mom/);
  assert.match(await completeTask(1), /Marked #1 done/);
  const r = await completeTask(2);
  assert.match(r, /repeats next on/);
  const [t] = await query("SELECT * FROM tasks WHERE id=2");
  assert.equal(t.status, "open");
  assert.ok(new Date(t.due_at) > new Date());
  assert.match(String(await tool("add_task").invoke({ title: "x", due: "not a date" })), /Error: Could not read due time/);
});

test("tool output is masked, tool input is unmasked before saving", async () => {
  const token = await mask("asha.verma@example.com");
  const out = String(await tool("add_task").invoke({ title: `Email ${token}` }));
  assert.match(out, /\[\[PII_[0-9a-f]{8}\]\]/);
  const [t] = await query("SELECT title FROM tasks ORDER BY id DESC LIMIT 1");
  assert.equal(t.title, "Email asha.verma@example.com");
});

test("rollover moves unfinished one-off tasks to today, same time", async () => {
  await query("TRUNCATE tasks RESTART IDENTITY");
  const now = new Date("2026-11-19T08:00:00+05:30");
  await query("INSERT INTO tasks (title, due_at) VALUES ('old', '2026-11-17T10:15:00+05:30'), ('future', '2026-11-25T10:00:00+05:30')");
  await query("INSERT INTO tasks (title, due_at, recurrence) VALUES ('rec', '2026-11-17T10:00:00+05:30', 'daily')");
  assert.equal(await rollOver(now), 1);
  const rows = await query("SELECT title, due_at FROM tasks ORDER BY id");
  assert.equal(new Date(rows[0].due_at).toISOString(), new Date("2026-11-19T10:15:00+05:30").toISOString());
  assert.equal(new Date(rows[1].due_at).toISOString(), new Date("2026-11-25T10:00:00+05:30").toISOString());
});
